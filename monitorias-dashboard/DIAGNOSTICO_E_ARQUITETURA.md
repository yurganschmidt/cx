# Refatoração do fluxo de contestação das monitorias — Diagnóstico e Arquitetura

> Este documento é a entrega do diagnóstico pedido antes da implementação (seção 13-14 do pedido).
> O código refatorado está em `Code.gs` e `Index.html` nesta mesma pasta.

---

## A. Como funciona hoje (n8n → planilha → Apps Script → dashboard)

**n8n (`trigger-sheets-monitorias`)**

1. `Webhook` (POST) dispara o fluxo. É acionado pelo botão "Nova Aba" do menu da planilha
   (`dispararFluxoN8NNovaAba()` em `Code.gs`, que faz um `POST` para
   `https://n8n.olist.com/webhook/trigger-sheets-monitorias`).
2. `Ler Planilha1` lê a aba **Monitorias**, range `B2:M`.
3. `Filter` só deixa passar linhas onde **`Feedback` está vazio** *e* `row_number > 641`.
   - O `row_number > 641` é um corte fixo, resquício de uma migração manual (provavelmente para não
     reprocessar linhas antigas). Isso é uma dívida técnica: é um número mágico permanente dentro de um
     fluxo de produção.
   - A condição `!Feedback` é o que hoje **protege** qualquer linha já avaliada (inclusive uma linha
     cuja nota/feedback tenha sido revisada por um humano) de ser reprocessada pela IA. Isso é importante
     e será usado como uma invariante da nova arquitetura (seção E/n8n abaixo).
4. `Loop` (`splitInBatches`) processa item a item.
5. `AI Monitor (Chain)` envia o prompt de auditoria + a conversa para o Gemini 2.5 Flash Lite e retorna
   `{ nota, feedback, oportunidades }`.
6. `Code in JavaScript` faz o parse do JSON de resposta (com fallback via regex se o texto vier cortado).
7. `Salvar Resultado1` faz um **update** na aba Monitorias, casando pela coluna `N. do atendimento`, e
   escreve `Nota`, `Feedback`, `Oportunidades`, `Semana`.
8. `Aguarda 2 segundos` e volta ao loop.

**Apps Script (`Code.gs` + `Index.html`)**

- `doGet()` serve `Index.html` como Web App.
- `getAdminEmails()` lê a aba **Admins** (coluna A) — essa é a fonte única e confiável de quem é
  administrador. Não existe (nem deve ser criada) uma segunda lista de admins em outro lugar.
- `getDashboardData()`:
  - Lê a aba **Monitorias** inteira, cabeçalho na **linha 2** (`data[1]`), dados a partir da **linha 3**.
  - Identifica o usuário logado via `Session.getActiveUser().getEmail()`.
  - `ehAdmin = emailsAdmin.includes(emailUsuario)`.
  - Filtra linhas por **`Status da monitoria === 'disponivel'`** (para todo mundo, inclusive admin).
  - Aplica **RLS (Row-Level Security) por e-mail** quando `!ehAdmin`: só devolve linhas cujo e-mail
    (coluna com header contendo "e-mail"/"email") bate com o e-mail da sessão. **Esse filtro por request,
    dentro de `getDashboardData()`, é a única barreira de segurança real do dashboard** — é o que decide
    o que cada agente pode ver.
  - Monta o JSON de cada linha por **nome de cabeçalho** (`headers.findIndex`), exceto duas colunas que
    são lidas por **índice fixo**: `Lido` (coluna T, índice 19/20) e `Caso Crítico` (coluna W, índice 22).
  - **`N. do atendimento` é o identificador único de cada monitoria** — é usado em todo o pipeline:
    n8n casa por ele, `marcarComoLidoSheet`/`updateFeedbackStatusOnSheet` procuram a linha por ele, e o
    Google Form de contestação também usa ele. Não existe (nem é necessário criar) outro ID de monitoria.
- `marcarComoLidoSheet(chatId)`: agente marca "Li esse feedback" → grava `"Sim."` na coluna T.
- `updateFeedbackStatusOnSheet(chatId, bool)`: admin marca "Avaliação aplicada?" → grava Sim/Não na
  coluna com header "aplicada".
- `aplicarRLS()` / `restaurarVisao()`: **mecanismo separado e redundante**. Em vez de filtrar o JSON,
  essas funções literalmente escondem/mostram linhas na planilha real, para quem quer que as execute
  (via menu/botão). Isso não tem relação com o dashboard (que já faz RLS por request) e, por rodar como
  "quem clicou o botão", não serve para múltiplos usuários simultâneos — é uma segunda implementação de
  controle de acesso que não conversa com a primeira. Não faz parte do escopo desta refatoração (não vou
  alterá-la), mas fica registrada como inconsistência (ver seção C.6).
- `dispararFluxoN8N()` / `dispararFluxoN8NNovaAba()`: disparam o webhook do n8n. Não têm relação com
  contestação.

---

## B. Como funciona hoje a contestação (onde ela está implementada)

A contestação **não é um fluxo dentro do dashboard** — é um **Google Form externo**, desconectado da
autenticação do Web App:

1. No modal de detalhe, existe um link `<a id="modalFormLink">Abrir formulário</a>` que aponta para uma
   URL de Google Forms, com o `N. do atendimento` pré-preenchido via query string
   (`entry.1606454677=<chatId>`).
2. Isso abre uma aba nova, **fora do dashboard**, sem checar se quem está preenchendo é realmente o dono
   daquela monitoria.
3. O Form tem um trigger instalável `onFormSubmit → processarEnvioDoFormulario(e)`, que:
   - Lê `e.namedValues['Número do Atendimento']` e o texto da pergunta
     `'Qual o motivo da contestação?...'`.
   - Procura a linha em Monitorias pelo `N. do atendimento`.
   - **Sobrescreve a coluna "Contestação"** com o texto do motivo.
4. No dashboard, dois campos são exibidos como se fossem conceitos diferentes:
   - `Houve contestação?` ← lê a coluna cujo header contém `"contestação"` (a mesma que o Form sobrescreve
     com texto livre — ou seja, esse campo mostra um texto livre como se fosse uma resposta Sim/Não).
   - `Descreva o motivo` ← lê uma coluna **diferente**, cujo header contém `"descreva o motivo"`. Só que
     **nada no código escreve nessa coluna** — ela só teria conteúdo se alguém preenchesse manualmente na
     planilha. Ou seja, o caminho de escrita (Form → coluna "Contestação") e o caminho de leitura que o
     agente vê como "motivo" (coluna "descreva o motivo") **são colunas diferentes**. Esse descompasso é
     exatamente a "experiência quebrada/confusa" relatada.

Não existe, em lugar nenhum, nota original, feedback original, status de análise, decisão, justificativa
da Lari, nova nota ou novo feedback. A "contestação" hoje é, literalmente, uma célula de texto livre que
pode ser sobrescrita a qualquer momento, sem histórico e sem vínculo de identidade.

---

## C. Problemas encontrados

1. **Descompasso escrita/leitura da contestação** — Form escreve na coluna "Contestação"; UI lê
   "Descreva o motivo" de outra coluna que ninguém preenche via código. Já explicado no item B.
2. **Nenhuma validação de identidade** — o Form é um link público do Google Forms, sem sessão. Qualquer
   pessoa com o link pode preencher qualquer `N. do atendimento`, inclusive de outro agente.
3. **Sem prevenção de duplicidade** — nada impede reenvio do Form para o mesmo atendimento; cada envio
   apenas sobrescreve a célula anterior, **destruindo silenciosamente o texto anterior sem deixar rastro**.
4. **Sem máquina de estado** — não existe "aberta/em análise/aceita/recusada". Uma célula de texto não
   comunica status nenhum ao agente.
5. **Sem preservação de nota/feedback originais** — não existe fluxo de revisão hoje, então esse risco
   (perder o dado original) ainda não se materializou, mas a spec pede que a nova solução garanta isso.
6. **Duas implementações de RLS que não se conversam**: o filtro por e-mail dentro de
   `getDashboardData()` (por requisição, correto para multiusuário) vs. `aplicarRLS()`/`restaurarVisao()`
   (esconde linhas fisicamente na planilha, para quem clicar o botão). A segunda não tem efeito nenhum
   sobre o dashboard e pode confundir quem mantém o script achando que ali é onde a segurança acontece.
   **Fora do escopo desta tarefa — não alterada —, mas registrada para conhecimento.**
7. **Corte hardcoded `row_number > 641`** no node `Filter` do n8n — resquício de migração manual, deixado
   permanentemente em produção. Não vou alterar o JSON do n8n sem confirmação explícita (a spec pede isso),
   mas deixo a recomendação registrada na seção E.
8. **Mistura de índice fixo de coluna com busca por nome de cabeçalho**: `Lido` (coluna T) e `Caso Crítico`
   (coluna W) são lidos por posição fixa; o e-mail em `aplicarRLS()` também usa índice fixo (coluna V).
   Se alguém inserir ou reordenar uma coluna em Monitorias, esses pontos quebram silenciosamente (sem
   erro visível) — diferente das colunas buscadas por header, que ao menos falham de forma previsível
   (índice -1 → campo vazio). Fora do escopo desta refatoração de contestação, mas fica registrado.
9. **Sem trilha de auditoria** — não existe, hoje, quem decidiu, quando, por quê, nem valores anteriores
   vs. revisados.
10. **A proteção contra sobrescrita do n8n existe, mas é acidental** — o Filter (`!Feedback`) hoje evita
    que o n8n reprocesse uma linha já avaliada. Isso é bom e será preservado como invariante: a nova nota
    revisada pela Lari **precisa continuar sendo escrita na mesma célula `Feedback`** para que o n8n
    continue enxergando a linha como "já avaliada" e nunca a sobrescreva.

---

## D. Arquitetura proposta

```
Agente (não-admin)
  → abre a monitoria no dashboard (getDashboardData, RLS por e-mail já existente)
  → lê feedback/oportunidades
  → clica "Discordar do feedback" (só aparece se não houver contestação registrada)
  → preenche motivo no próprio modal (sem sair do dashboard, sem Google Form)
  → abrirContestacao(chatId, motivo)   [Apps Script, novo]
        - identifica o agente pela sessão (Session.getActiveUser), nunca por input do cliente
        - valida: motivo obrigatório, monitoria existe, agente é dono da linha, ainda não existe
          contestação para esta monitoria
        - lê nota/feedback/oportunidades ATUAIS da planilha (não confia em nada vindo do navegador)
        - grava uma linha nova na aba "Contestacoes" (nova aba, criada automaticamente pelo script
          na primeira execução) com status "Aberta"
  → dashboard mostra "Contestação enviada — aguardando análise da Qualidade"
  → botão de contestar some (não é possível abrir uma segunda)

Lari (Qualidade), direto na planilha
  → aba "Contestacoes" lista tudo: quem, qual monitoria, nota/feedback originais, motivo, status
  → usa o menu "Contestações" (novo, adicionado por Code.gs) na planilha:
        - "Marcar como Em Análise..." → status "Em Análise"
        - "Aceitar contestação..." → pede justificativa + nova nota/feedback (opcionais; se em
          branco, mantém os valores originais) → decidirContestacao(id, 'Aceita', ...)
        - "Recusar contestação..." → pede justificativa (obrigatória) → decidirContestacao(id,
          'Recusada', ...)
  → decidirContestacao() é bloqueado por e-mail de admin (mesma lista de Admins já existente) e
    recusa decidir uma contestação que já esteja "Aceita"/"Recusada" (ciclo fechado)
  → se Aceita: Code.gs atualiza Nota/Feedback/Oportunidades na aba Monitorias (a versão "atual" que
    o dashboard sempre mostrou), preservando os valores originais dentro da própria linha da aba
    Contestacoes (capturados no momento da abertura, nunca sobrescritos)

Agente
  → reabre a monitoria → getDashboardData() faz o "join" Monitorias + Contestacoes por
    N. do atendimento e devolve um objeto Contestacao com o status atual
  → vê "Contestação aceita" + nova nota + novo feedback, ou "Contestação não aceita" + justificativa
  → não consegue abrir uma nova contestação para a mesma monitoria (o botão nunca reaparece,
    e o backend também recusa se alguém tentar forçar via console)
```

### Modelo de status (ciclo fechado)

Em vez de 5 estados (`Aberta → Em Análise → Aceita/Recusada → Encerrada`), proponho **4 estados**, onde
`Aceita` e `Recusada` já são, por definição, estados terminais — não precisam de um quinto status
"Encerrada" separado, porque nada no sistema permite sair deles:

```
Aberta ──► Em Análise ──► Aceita   (terminal)
   │                  └─► Recusada (terminal)
   └───────────────────────────────────────────► (Aceita/Recusada direto, "Em Análise" é opcional)
```

`decidirContestacao()` só aceita decidir contestações com status `Aberta` ou `Em Análise`. Uma vez
`Aceita`/`Recusada`, qualquer nova tentativa de decisão é rejeitada com erro — isso é o que impede
reabertura e sobrescrita de decisão.

---

## E. Alterações necessárias

### Planilha (Google Sheets)

- **Nova aba "Contestacoes"**: **criada automaticamente pelo Apps Script** na primeira chamada (não
  precisa ser criada manualmente). Cabeçalho na linha 1:

  `ID Contestação | ID Monitoria | Agente | Email Agente | Data Contestação | Motivo Contestação | Nota Original | Feedback Original | Oportunidades Original | Status | Data da Análise | Responsável pela Análise | Decisão | Justificativa da Decisão | Nova Nota | Novo Feedback | Novas Oportunidades | Data da Revisão`

- **Não crio nem removo nenhuma coluna na aba Monitorias.** As colunas antigas "Contestação" e a coluna
  cujo header contém "descreva o motivo" deixam de ser lidas/escritas pelo novo fluxo — ficam como
  histórico morto. Recomendo (ação manual sua, não fiz automaticamente por não alterar estrutura sem
  confirmação): renomear essas duas colunas para algo como `"Contestação (legado)"` só para deixar claro
  que não são mais usadas, ou simplesmente ignorá-las.
- **Ação manual obrigatória**: desativar/excluir o Google Form de contestação e seu trigger instalável
  `onFormSubmit → processarEnvioDoFormulario`. Eu não tenho acesso a esse Form nem ao editor de triggers
  da planilha para fazer isso remotamente — só removi a função `processarEnvioDoFormulario` do código,
  mas o trigger em si (Extensões → Apps Script → Acionadores) precisa ser apagado por você, senão ele
  ficará "pendurado" apontando para uma função que não existe mais.

### n8n

**Nenhuma alteração é necessária no fluxo que você mandou** para suportar a nova contestação — ele só
faz a avaliação inicial via IA, e o novo fluxo de contestação vive inteiramente em Apps Script + a nova
aba, sem tocar no n8n.

Duas recomendações, que **não apliquei** (você pediu para não alterar o JSON sem confirmar antes):

1. **Remover o corte `row_number > 641`** do node `Filter` (ou documentar por que ele precisa continuar
   ali) — hoje ele é um número mágico sem explicação no fluxo.
2. **Manter a condição `!Feedback`** exatamente como está — é ela quem impede o n8n de sobrescrever uma
   nota/feedback já revisados pela Lari (porque `_atualizarMonitoriaRevisada_` grava o novo feedback na
   mesma célula `Feedback`, então a linha deixa de ser "vazia" e o n8n nunca mais a tocará). **Não é
   necessário criar nenhuma proteção nova no n8n** — a proteção que já existe, ainda que acidental,
   é suficiente, desde que a revisão sempre escreva na coluna `Feedback` (é o que o código novo faz).

Se no futuro vocês quiserem que o n8n dispare algo quando uma contestação for aberta ou decidida (ex.:
notificar a Lari no Slack), isso seria um novo webhook chamado a partir de `abrirContestacao`/
`decidirContestacao` — não incluí isso porque não foi pedido e adicionaria uma dependência externa nova.

### Apps Script (`Code.gs`)

**Removido:**
- `processarEnvioDoFormulario(e)` — lógica do Form antigo.
- Leitura de `idxContestacao` / `idxContestacaoMotivo` e os campos `Houve contestação?` / `Descreva o
  motivo` no JSON devolvido por `getDashboardData()`.

**Mantido sem alteração:**
- `doGet`, `getAdminEmails`, `_cols_`, `_ehCritico_`, `marcarComoLidoSheet`, `updateFeedbackStatusOnSheet`,
  `dispararFluxoN8N`, `dispararFluxoN8NNovaAba`, `abrirDashboard`, `aplicarRLS`, `restaurarVisao`.

**Novo:**
- Constantes `CONTESTACAO_SHEET_NAME` / `CONTESTACAO_HEADERS`.
- `_getOrCreateContestacoesSheet_()`, `_contestacaoHeaderMap_()`, `_buscarContestacaoPorMonitoria_()`,
  `_buscarContestacaoPorId_()`, `_mapaContestacoesPorMonitoria_()`, `_lerMonitoriaPorChat_()`,
  `_atualizarMonitoriaRevisada_()`, `_formatarDataBR_()`.
- `abrirContestacao(chatId, motivo)` — chamada pelo agente.
- `marcarContestacaoEmAnalise(id)`, `decidirContestacao(id, decisao, justificativa, novaNota,
  novoFeedback, novasOportunidades)` — só para admins.
- `onOpen()` + `menuMarcarEmAnalise_()`, `menuAceitarContestacao_()`, `menuRecusarContestacao_()` — menu
  "Contestações" na planilha, para a Lari decidir sem precisar de outra tela.
- `getDashboardData()` alterado: faz o join com a aba Contestacoes e devolve um objeto `Contestacao` por
  linha, no lugar dos dois campos antigos.

### Dashboard (`Index.html`)

**Removido:** o bloco "Contestação? / Contestar → Abrir formulário / Motivo Contestação" e a referência
ao Google Form (`modalFormLink`).

**Novo:** um painel `contestacaoPanel`, renderizado conforme o status (`Nenhuma`, `Aberta`/`Em Análise`,
`Aceita`, `Recusada`), com o botão "Discordar do feedback" → textarea inline → `abrirContestacao()` via
`google.script.run`, sem sair do dashboard e sem Google Form.

---

## F. O que foi reaproveitado

- Identificação única da monitoria: `N. do atendimento`.
- RLS por e-mail em `getDashboardData()` (única barreira de acesso real — mantida como está).
- `getAdminEmails()` / aba **Admins** como única fonte de verdade de quem é administrador — a nova
  lógica de contestação (`decidirContestacao`, menu da Lari) usa exatamente essa mesma função, sem criar
  uma segunda lista.
- Fluxo "Li esse feedback" / coluna `Lido` — inalterado, é ortogonal à contestação.
- `updateFeedbackStatusOnSheet` (checkbox do admin) — inalterado.
- Todo o visual/branding do dashboard (cores, tipografia, layout do modal).
- A proteção que o n8n já tem contra sobrescrever linhas com `Feedback` preenchido.

## G. O que foi eliminado

- O Google Form de contestação e o handler `processarEnvioDoFormulario` (a lógica do lado do Apps
  Script foi removida; a exclusão do Form/trigger em si é manual, ver seção E).
- Os dois campos inconsistentes `Houve contestação?` / `Descreva o motivo` (lidos de colunas que não
  correspondiam ao que era escrito) — substituídos pelo objeto `Contestacao` vindo da nova aba.

---

## Resumo objetivo

**O que existia:** um link para um Google Form externo, desconectado do dashboard, sem identidade, sem
status, sem histórico — escrevendo texto livre numa coluna que a UI nem lia como "motivo".

**O que estava quebrado:** a coluna que o Form escrevia (`Contestação`) e a coluna que a UI mostrava como
"Descreva o motivo" eram colunas diferentes; qualquer pessoa com o link do Form podia contestar qualquer
atendimento; reenvios apagavam contestações anteriores sem deixar rastro; não havia como saber se uma
contestação estava em análise, aceita ou recusada.

**O que foi alterado:** criei uma aba nova ("Contestacoes") com um ciclo de vida fechado
(`Aberta → Em Análise → Aceita/Recusada`, sem reabertura), um formulário embutido no próprio modal do
dashboard (sem Google Form), validação de identidade pela sessão do Google, bloqueio de contestação
duplicada, um menu na planilha para a Lari decidir com justificativa obrigatória, e atualização da
Nota/Feedback "atuais" em Monitorias só quando a contestação é aceita — preservando os valores originais
na própria linha da aba Contestacoes.

**Como o novo fluxo funciona:** agente clica "Discordar do feedback" no modal → escreve o motivo → envia
sem sair do dashboard → acompanha o status (enviada/em análise/aceita/recusada) na próxima vez que abrir
a mesma monitoria → se aceita, vê a nova nota e o novo feedback ali mesmo.

**O que você precisa fazer manualmente para colocar em produção:**
1. Colar o `Code.gs` e o `Index.html` desta pasta no projeto Apps Script real (substituindo os atuais).
2. Publicar uma nova implantação (deployment) do Web App.
3. Apagar, em Extensões → Apps Script → Acionadores (Triggers), o trigger `onFormSubmit` que aponta para
   `processarEnvioDoFormulario` (a função não existe mais no código).
4. Opcional: desativar/arquivar o Google Form antigo de contestação e renomear as colunas legadas
   "Contestação" / "descreva o motivo" na aba Monitorias, para deixar claro que não são mais usadas.
5. Nenhuma alteração é necessária no fluxo do n8n para este trabalho; as duas recomendações da seção E
   (remover o corte `row_number > 641`, documentar a proteção `!Feedback`) ficam para você decidir.
