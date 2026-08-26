# Tela de treinamento + confirmação de presença

Duas páginas estáticas, sem build, prontas para publicar junto com o restante do site:

- `tela.html` — tela compartilhada no Google Meet (analista escolhe o tema do treinamento, a duração da contagem regressiva, e inicia a sessão).
- `presenca.html` — página que o cliente abre para confirmar presença informando o CNPJ.
- `apps-script.gs` — script do Google Apps Script que grava as confirmações numa planilha do Google Sheets.

## Tema do treinamento

A tela `tela.html` tem uma lista de temas prontos (Treinamento Olist, Integrações, Logística, Cadastro de produto, Expedição, Dia a Dia do ERP, Financeiro) e agora também um botão **✏️ Personalizado**.

Ao clicar em **Personalizado**, aparece um campo de texto para digitar qualquer tema. Esse tema personalizado:
- segue a mesma lógica de seleção dos demais (fica destacado enquanto ativo; escolher outro tema desativa o personalizado);
- reflete **em tempo real** no título da tela de apresentação (a que fica em compartilhamento de tela no Meet);
- é usado no link/QR Code de confirmação de presença;
- é o valor gravado na coluna "Tema" da planilha.

## Link e QR Code de confirmação

`tela.html` gera automaticamente:
- um **QR Code** (desenhado localmente, sem depender de serviço externo) que aponta para `presenca.html` já com o tema atual e o link do Meet;
- um botão **Copiar link do cliente**, para colar no chat do Meet.

O cliente aponta a câmera do celular (ou clica no link) para abrir `presenca.html`, digita o CNPJ e confirma a presença. A confirmação é enviada ao Apps Script e some do lado do cliente com uma tela de sucesso.

## Configuração

1. Suba a planilha e o Apps Script seguindo os comentários no topo de `apps-script.gs` (aba `Presencas`, colunas `Data e hora | Tema | CNPJ`).
2. Publique `tela.html` e `presenca.html` junto com o resto do site (mesma pasta).
3. Abra a tela do analista com parâmetros na URL, por exemplo:
   `tela.html?meet=https://meet.google.com/xxx-yyyy-zzz`
   - `?api=` sobrescreve o endpoint do Apps Script (por padrão já aponta para o endpoint configurado no código).
   - `?lp=` sobrescreve a URL da página de confirmação (por padrão usa `presenca.html` na mesma pasta).
   - `?tema=` pré-seleciona um tema (se não for um dos temas prontos, entra automaticamente no modo personalizado).
   - `?min=` pré-seleciona a duração da contagem regressiva, em minutos.
4. Escolha o tema (ou digite um personalizado), escolha a duração, copie o link do cliente e clique em **Iniciar e ocultar controles**.
