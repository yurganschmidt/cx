/**
 * Dashboard de Qualidade — Onboarding
 * Backend Apps Script para a aba Resultados_v2 (fluxo n8n v2-4pilares).
 *
 * Instalação:
 * 1. Planilha > Extensões > Apps Script
 * 2. Crie "Code.gs" e "Index.html" com estes conteúdos
 * 3. Implantar > Nova implantação > App da Web > Executar como: eu > Acesso: sua organização
 *
 * Diferenças em relação à versão antiga:
 * - As colunas são localizadas pelo CABEÇALHO, não por índice fixo. Reordenar ou
 *   inserir coluna na planilha não quebra mais o dashboard.
 * - getDados() devolve um payload LEVE (sem justificativas e evidências, que são
 *   os campos longos). O texto completo vem sob demanda em getDetalhe(id).
 *   É o que mantém o app rápido quando a base passar de algumas centenas de linhas.
 * - O comentário é gravado casando id_transcricao, não posição de linha.
 * - getOportunidadesConsolidadas() lê a coluna "Insights e Oportunidades (JSON)"
 *   (gravada pelo n8n a partir da v2 dos formatadores) e devolve as oportunidades
 *   agrupadas por área de destino, para a visão de gestão (Ajuste 4 / Opção A).
 * - CONTROLE DE ACESSO POR E-MAIL: administradores (aba "Admins") veem todas as
 *   consultorias; os demais usuários só recebem, do servidor, as linhas cujo
 *   "Analista (e-mail)" bate com o e-mail Google de quem está acessando o app.
 *   O filtro acontece nas funções que leem a planilha (getDados, getDetalhe,
 *   getOportunidadesConsolidadas, atualizarComentario) — nunca no front-end —
 *   então manipular filtros/elementos da interface não expõe dado de terceiros.
 *   Pré-requisito: o deployment do Web App precisa estar com "Quem pode acessar"
 *   restrito ao domínio Google Workspace da empresa (não "Qualquer pessoa com uma
 *   Conta do Google"), senão Session.getActiveUser() pode não conseguir
 *   identificar quem está acessando.
 */

var SHEET_NAME      = 'Resultados_v2';
var COL_ID          = 'id_transcricao';
var COL_COMENT      = 'Comentários e Ajustes';
var COL_OPORT_JSON  = 'Insights e Oportunidades (JSON)';
var COL_EMAIL       = 'Analista (e-mail)';

/** Aba com a lista de administradores: um e-mail por linha, coluna A, sem cabeçalho obrigatório. */
var ADMIN_SHEET_NAME = 'Admins';

var MSG_SEM_EMAIL_ = 'Não foi possível identificar seu e-mail Google. Acesse este dashboard logado ' +
  'com sua conta do Google Workspace da empresa (não uma conta pessoal) e tente novamente. Se o ' +
  'problema persistir, confirme com quem administra o script se o deployment está com "Quem pode ' +
  'acessar" restrito ao domínio da organização.';

/* ========================= entrada ========================= */

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Qualidade das consultorias — Onboarding')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/* ========================= planilha ========================= */

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = SHEET_NAME ? ss.getSheetByName(SHEET_NAME) : ss.getSheets()[0];
  if (!sh) throw new Error('Aba "' + SHEET_NAME + '" não encontrada.');
  return sh;
}

function norm_(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Mapa cabeçalho normalizado -> índice 0-based. */
function mapaColunas_(sheet) {
  var largura = sheet.getLastColumn();
  var cab = sheet.getRange(1, 1, 1, largura).getValues()[0];
  var mapa = {};
  for (var i = 0; i < cab.length; i++) {
    var k = norm_(cab[i]);
    if (k && mapa[k] === undefined) mapa[k] = i;
  }
  return mapa;
}

function txt_(v) { return (v === null || v === undefined) ? '' : String(v).trim(); }

var _TZ = null;
function tz_() {
  if (!_TZ) _TZ = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone() || 'America/Sao_Paulo';
  return _TZ;
}

/** Número ou null. Aceita vírgula decimal. */
function num_(v) {
  if (v === '' || v === null || v === undefined) return null;
  if (typeof v === 'number') return isNaN(v) ? null : v;
  var n = parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? null : n;
}

function bool_(v) {
  var s = norm_(v);
  if (s === 'true' || s === 'sim' || s === 'verdadeiro') return true;
  if (s === 'false' || s === 'nao' || s === 'falso') return false;
  return null;
}

/** Qualquer data para 'YYYY-MM-DD'. */
function toISODate_(value) {
  if (!value && value !== 0) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, tz_(), 'yyyy-MM-dd');
  }
  var s = String(value).trim();
  var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
  var br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (br) {
    var p = function (x) { return ('0' + x).slice(-2); };
    return br[3] + '-' + p(br[2]) + '-' + p(br[1]);
  }
  return s;
}

/** 'Coletiva (Tier 2)' -> 'Coletiva'. */
function tipo_(v) {
  var s = norm_(v);
  if (s.indexOf('coletiva') > -1) return 'Coletiva';
  if (s.indexOf('individual') > -1) return 'Individual';
  return txt_(v);
}

/** Rótulos de severidade / impacto para a forma canônica do dashboard. */
function rotulo_(v) {
  var s = norm_(v);
  if (s === 'alto' || s === 'alta') return 'Alto';
  if (s === 'medio' || s === 'media') return 'Médio';
  if (s === 'baixo' || s === 'baixa') return 'Baixo';
  if (s === 'ausente' || s === '' || s === 'n/a' || s === 'n/d') return 'Ausente';
  return txt_(v);
}

/* ========================= permissões ========================= */

/**
 * E-mail Google de quem está acessando o Web App agora, normalizado
 * (minúsculo, sem espaços). Vazio se não for possível identificar —
 * nesse caso as funções de leitura devem negar acesso, nunca liberar
 * o dataset completo por engano.
 */
function emailUsuarioAtual_() {
  try {
    return norm_(Session.getActiveUser().getEmail());
  } catch (e) {
    return '';
  }
}

/**
 * Lista de e-mails de administrador, lida da aba "Admins" (coluna A,
 * um e-mail por linha; linhas sem "@" — como um eventual cabeçalho —
 * são ignoradas). Se a aba não existir, devolve lista vazia: por
 * padrão ninguém é admin até a aba ser criada (falha fechada).
 */
function getAdminEmails_() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(ADMIN_SHEET_NAME);
    if (!sh) return [];
    var ultima = sh.getLastRow();
    if (ultima < 1) return [];
    var valores = sh.getRange(1, 1, ultima, 1).getValues();
    var out = [];
    valores.forEach(function (row) {
      var e = norm_(row[0]);
      if (e && e.indexOf('@') > -1) out.push(e);
    });
    return out;
  } catch (e) {
    return [];
  }
}

function ehAdmin_(emailNormalizado) {
  if (!emailNormalizado) return false;
  return getAdminEmails_().indexOf(emailNormalizado) > -1;
}

/** { email, admin } de quem está acessando agora. Base de toda checagem de permissão. */
function contextoUsuario_() {
  var email = emailUsuarioAtual_();
  return { email: email, admin: ehAdmin_(email) };
}

/**
 * Nome para exibir no cabeçalho ("Olá, ..."). Procura, entre as linhas da
 * planilha, alguma em que "Analista (e-mail)" bata com o e-mail de quem está
 * acessando e usa o nome daquela linha. Se não achar (ex.: um admin que não
 * é analista na planilha), deriva um nome a partir da parte local do e-mail.
 */
function nomeExibicao_(ctx, itensCache) {
  if (!ctx.email) return '';

  var itens = itensCache || lerLinhas_();
  var propria = itens.filter(function (it) { return norm_(it.email) === ctx.email; })[0];
  if (propria && propria.nome) return propria.nome;

  var local = ctx.email.split('@')[0];
  var partes = local.split(/[._-]+/).filter(Boolean);
  if (!partes.length) return ctx.email;
  return partes.map(function (p) { return p.charAt(0).toUpperCase() + p.slice(1); }).join(' ');
}

/* ========================= leitura ========================= */

/**
 * Payload leve: tudo que a visão geral, os filtros, a busca e a lista precisam.
 * Os campos longos (justificativas, evidências, tópicos, passos) ficam fora e
 * são buscados por getDetalhe(id) quando a gestora abre uma monitoria.
 *
 * Filtro de permissão aplicado aqui: quem não é admin só recebe as linhas cujo
 * "Analista (e-mail)" é o próprio e-mail de quem está logado.
 */
function getDados() {
  try {
    var ctx = contextoUsuario_();
    if (!ctx.email) return { ok: false, erro: MSG_SEM_EMAIL_ };

    var itens = lerLinhas_();
    if (!ctx.admin) {
      itens = itens.filter(function (it) { return norm_(it.email) === ctx.email; });
    }
    return { ok: true, itens: itens, admin: ctx.admin, email: ctx.email };
  } catch (e) {
    return { ok: false, erro: String(e && e.message || e), stack: String(e && e.stack || '') };
  }
}

function getDadosFresh() { return getDados(); }

function lerLinhas_() {
  var sheet = getSheet_();
  var ultima = sheet.getLastRow();
  if (ultima < 2) return [];

  var mapa = mapaColunas_(sheet);
  var valores = sheet.getRange(2, 1, ultima - 1, sheet.getLastColumn()).getValues();

  var g = function (linha, cabecalho) {
    var i = mapa[norm_(cabecalho)];
    return i === undefined ? '' : linha[i];
  };

  var out = [];
  for (var r = 0; r < valores.length; r++) {
    var L = valores[r];
    var id = txt_(g(L, COL_ID));
    var nome = txt_(g(L, 'Analista'));
    var resumo = txt_(g(L, 'Resumo Qualitativo'));
    if (!id && !nome && !resumo) continue;

    var riscosTxt = txt_(g(L, 'Riscos NPS/Churn'));
    var insightsTxt = txt_(g(L, 'Insights e Oportunidades'));

    out.push({
      id: id || ('linha-' + (r + 2)),
      linha: r + 2,
      data: toISODate_(g(L, 'Data da Reunião')),
      titulo: txt_(g(L, 'Título da Reunião')),
      nome: nome,
      email: txt_(g(L, COL_EMAIL)),
      tier: txt_(g(L, 'Tier')),
      tipo: tipo_(g(L, 'Tipo Consultoria')),
      link: txt_(g(L, 'Link da Transcrição')),
      processadoEm: txt_(g(L, 'Processado em')),
      versaoRegua: txt_(g(L, 'Versão da Régua')),
      cliente: txt_(g(L, 'Cliente/Conta')),
      resumo: resumo,

      riscoSevMax: rotulo_(g(L, 'Risco Severidade Máx')),
      insightAreas: txt_(g(L, 'Insight Áreas')),
      insightImpactoMax: rotulo_(g(L, 'Insight Impacto Máx')),
      nRiscos: riscosTxt ? riscosTxt.split(/\n\s*\n/).length : 0,
      nInsights: insightsTxt ? insightsTxt.split(/\n\s*\n/).length : 0,

      // Campos PLANOS de propósito. A ponte google.script.run silencia o callback
      // (nem sucesso nem falha) quando o retorno tem estrutura que ela não
      // consegue serializar; objeto aninhado era o único ponto de risco aqui.
      sDiagnostico: num_(g(L, 'Score Diagnóstico')),
      sDidatica: num_(g(L, 'Score Didática')),
      sObjecoes: num_(g(L, 'Score Objeções')),
      sTecnico: num_(g(L, 'Score Técnico')),
      sMedia: num_(g(L, 'Nota Média Final')),
      houveObjecao: bool_(g(L, 'Houve Objeção?')),
      nivel: txt_(g(L, 'Nível do Analista')),

      participantes: txt_(g(L, 'Participantes (qtd)')),
      temPendencias: !!txt_(g(L, 'Pendências')),
      temTopicos: !!txt_(g(L, 'Tópicos Recorrentes')),
      temComentario: !!txt_(g(L, COL_COMENT))
    });
  }

  out.sort(function (a, b) { return (b.data || '').localeCompare(a.data || ''); });
  return out;
}

/**
 * Registro completo de uma monitoria, incluindo todo o texto longo.
 * Filtro de permissão aplicado aqui também: mesmo que alguém chame
 * getDetalhe(id) diretamente (fora da lista já filtrada do front-end),
 * o servidor nega o registro se o id não pertencer ao usuário e ele
 * não for admin.
 */
function getDetalhe(id) {
  try {
    var ctx = contextoUsuario_();
    if (!ctx.email) return { ok: false, erro: MSG_SEM_EMAIL_ };

    var item = lerDetalhe_(id);
    if (!item) return { ok: true, item: null };

    if (!ctx.admin && norm_(item.emailAnalista) !== ctx.email) {
      return { ok: false, erro: 'Você não tem permissão para visualizar esta consultoria.' };
    }
    return { ok: true, item: item };
  } catch (e) {
    return { ok: false, erro: String(e && e.message || e) };
  }
}

function lerDetalhe_(id) {
  var sheet = getSheet_();
  var ultima = sheet.getLastRow();
  if (ultima < 2) return null;

  var mapa = mapaColunas_(sheet);
  var iId = mapa[norm_(COL_ID)];
  var valores = sheet.getRange(2, 1, ultima - 1, sheet.getLastColumn()).getValues();

  var L = null;
  for (var r = 0; r < valores.length; r++) {
    if (iId !== undefined && txt_(valores[r][iId]) === String(id)) { L = valores[r]; break; }
    if (iId === undefined && ('linha-' + (r + 2)) === String(id)) { L = valores[r]; break; }
  }
  if (!L) return null;

  var g = function (cabecalho) {
    var i = mapa[norm_(cabecalho)];
    return i === undefined ? '' : txt_(L[i]);
  };

  return {
    id: id,
    emailAnalista: g(COL_EMAIL),
    riscos: g('Riscos NPS/Churn'),
    insights: g('Insights e Oportunidades'),
    justificativas: {
      diagnostico: g('Justificativa Diagnóstico'),
      didatica: g('Justificativa Didática'),
      objecoes: g('Justificativa Objeções'),
      tecnico: g('Justificativa Técnico')
    },
    evidencias: {
      diagnostico: g('Evidência Diagnóstico'),
      didatica: g('Evidência Didática'),
      objecoes: g('Evidência Objeções'),
      tecnico: g('Evidência Técnico')
    },
    justificativaGeral: g('Justificativa Geral'),
    pontosFortes: g('Pontos Fortes'),
    planoDesenvolvimento: g('Plano de Desenvolvimento'),
    passosCliente: g('Próximos Passos Cliente'),
    passosAnalista: g('Próximos Passos Analista'),
    pendencias: g('Pendências'),
    topicos: g('Tópicos Recorrentes'),
    comentarios: g(COL_COMENT)
  };
}

/**
 * Metadados do cabeçalho do dashboard. A contagem de linhas reflete o que o
 * usuário atual realmente pode ver (admin = total da planilha; analista =
 * só as suas), para o texto do cabeçalho nunca sugerir mais dado do que o
 * usuário de fato recebeu.
 */
function getMeta() {
  try {
    var sheet = getSheet_();
    var ctx = contextoUsuario_();

    var linhas = 0, nome = '';
    if (ctx.email) {
      // Lê a planilha inteira uma vez só, e reaproveita tanto para achar o
      // nome do usuário (nomeExibicao_) quanto, quando não é admin, para
      // contar as linhas que ele pode ver.
      var itens = lerLinhas_();
      linhas = ctx.admin ? Math.max(0, sheet.getLastRow() - 1)
                         : itens.filter(function (it) { return norm_(it.email) === ctx.email; }).length;
      nome = nomeExibicao_(ctx, itens);
    }

    return {
      ok: true,
      sincronizadoEm: Utilities.formatDate(new Date(), tz_(), 'dd/MM/yyyy, HH:mm'),
      hoje: Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'),
      planilha: sheet.getName(),
      linhas: linhas,
      admin: ctx.admin,
      email: ctx.email,
      nome: nome
    };
  } catch (e) {
    return { ok: false, erro: String(e && e.message || e) };
  }
}

/* ===================== oportunidades consolidadas (Ajuste 4 / Opção A) ===================== */

/** Áreas aceitas pelos agentes — mesma ordem usada na visão consolidada. */
var AREAS_OPORTUNIDADE = ['Produto', 'Processos/Onboarding', 'Jornada Educacional', 'Documentação', 'Comunicação'];

var RANK_IMPACTO_ = { alto: 3, medio: 2, media: 2, baixo: 1, '': 0 };

/**
 * Lê a coluna "Insights e Oportunidades (JSON)" (gravada pelo n8n a partir da
 * v2 dos formatadores) e agrupa por área de destino. Linhas antigas (processadas
 * antes desse ajuste) não têm essa coluna preenchida e são ignoradas aqui — elas
 * continuam aparecendo normalmente na visão "Por que está acontecendo" via
 * "Insight Áreas" (texto).
 *
 * Igual às demais funções de leitura: quem não é admin só entra no cálculo com
 * as próprias linhas (comparando "Analista (e-mail)" com o e-mail de quem está
 * acessando), então a visão consolidada de um analista mostra só as oportunidades
 * dele mesmo, nunca do time inteiro.
 */
function getOportunidadesConsolidadas() {
  try {
    var ctx = contextoUsuario_();
    if (!ctx.email) return { ok: false, erro: MSG_SEM_EMAIL_ };

    return { ok: true, dados: consolidarOportunidades_(ctx), admin: ctx.admin };
  } catch (e) {
    return { ok: false, erro: String(e && e.message || e), stack: String(e && e.stack || '') };
  }
}

/**
 * @param {{admin:boolean,email:string}=} ctx Omitido apenas pelo diagnostico(),
 *   que roda direto no editor do Apps Script como o dono do projeto — nesse caso
 *   assume-se visão de admin (dataset completo) para fins de depuração.
 */
function consolidarOportunidades_(ctx) {
  ctx = ctx || { admin: true, email: '' };

  var sheet = getSheet_();
  var ultima = sheet.getLastRow();
  if (ultima < 2) return { areas: [], linhasComJson: 0, linhasTotal: 0 };

  var mapa = mapaColunas_(sheet);
  var iJson = mapa[norm_(COL_OPORT_JSON)];
  var iEmail = mapa[norm_(COL_EMAIL)];
  var valores = sheet.getRange(2, 1, ultima - 1, sheet.getLastColumn()).getValues();

  var g = function (linha, cabecalho) {
    var i = mapa[norm_(cabecalho)];
    return i === undefined ? '' : linha[i];
  };

  var grupos = {};
  AREAS_OPORTUNIDADE.forEach(function (a) { grupos[a] = []; });
  var linhasComJson = 0;

  for (var r = 0; r < valores.length; r++) {
    if (iJson === undefined) break; // coluna ainda não existe na planilha
    var L = valores[r];

    if (!ctx.admin) {
      var emailLinha = iEmail === undefined ? '' : norm_(L[iEmail]);
      if (emailLinha !== ctx.email) continue; // linha de outro analista: fora do cálculo
    }

    var bruto = txt_(L[iJson]);
    if (!bruto) continue;

    var lista;
    try {
      lista = JSON.parse(bruto);
    } catch (e) {
      continue; // linha com JSON inválido/corrompido: ignora sem quebrar o resto
    }
    if (!Array.isArray(lista) || !lista.length) continue;
    linhasComJson++;

    var contexto = {
      id: txt_(g(L, COL_ID)) || ('linha-' + (r + 2)),
      analista: txt_(g(L, 'Analista')),
      cliente: txt_(g(L, 'Cliente/Conta')),
      data: toISODate_(g(L, 'Data da Reunião'))
    };

    lista.forEach(function (item) {
      if (!item) return;
      var area = rotulo_(item.area_destino) === 'Ausente' ? txt_(item.area_destino) : txt_(item.area_destino);
      if (!area) return;
      if (!grupos[area]) grupos[area] = []; // área fora do enum conhecido: agrupa mesmo assim, não descarta
      grupos[area].push({
        oportunidade: txt_(item.oportunidade),
        acaoRecomendada: txt_(item.acao_recomendada),
        impacto: rotulo_(item.impacto),
        analista: contexto.analista,
        cliente: contexto.cliente,
        data: contexto.data,
        idTranscricao: contexto.id
      });
    });
  }

  var areas = Object.keys(grupos)
    .filter(function (a) { return grupos[a].length > 0; })
    .map(function (area) {
      var itens = grupos[area].slice();
      itens.sort(function (a, b) {
        var ra = RANK_IMPACTO_[norm_(a.impacto)] || 0;
        var rb = RANK_IMPACTO_[norm_(b.impacto)] || 0;
        if (rb !== ra) return rb - ra;
        return (b.data || '').localeCompare(a.data || '');
      });
      var porImpacto = { Alto: 0, Médio: 0, Baixo: 0 };
      itens.forEach(function (i) {
        if (porImpacto[i.impacto] !== undefined) porImpacto[i.impacto]++;
      });
      var analistas = [];
      var vistos = {};
      itens.forEach(function (i) {
        if (i.analista && !vistos[i.analista]) { vistos[i.analista] = 1; analistas.push(i.analista); }
      });
      return {
        area: area,
        total: itens.length,
        porImpacto: porImpacto,
        analistas: analistas,
        // limite de itens devolvidos por área para manter o payload leve;
        // a área continua "total" correto mesmo que a lista seja truncada.
        itens: itens.slice(0, 60)
      };
    })
    .sort(function (a, b) { return b.total - a.total; });

  return { areas: areas, linhasComJson: linhasComJson, linhasTotal: valores.length };
}

/**
 * DIAGNÓSTICO — rode esta função no editor do Apps Script (Executar > diagnostico)
 * e leia o registro de execução. Ela mostra, sem passar pela ponte do navegador:
 * quais abas existem, quais cabeçalhos foram reconhecidos, quantas linhas foram
 * lidas, o tamanho do payload e o estado da lista de administradores. Se getDados()
 * está travando ou alguém não está vendo o que deveria, o motivo aparece aqui.
 */
function diagnostico() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('Abas: ' + ss.getSheets().map(function (s) { return s.getName(); }).join(' | '));

  var sheet = getSheet_();
  Logger.log('Aba lida: "' + sheet.getName() + '" — ' + sheet.getLastRow() + ' linhas x ' + sheet.getLastColumn() + ' colunas');

  var mapa = mapaColunas_(sheet);
  Logger.log('Cabeçalhos reconhecidos: ' + Object.keys(mapa).length);

  var precisa = [COL_ID, 'Data da Reunião', 'Analista', COL_EMAIL, 'Tier', 'Tipo Consultoria', 'Cliente/Conta',
                 'Resumo Qualitativo', 'Risco Severidade Máx', 'Insight Áreas', 'Nota Média Final',
                 'Nível do Analista', COL_COMENT];
  var faltando = precisa.filter(function (c) { return mapa[norm_(c)] === undefined; });
  Logger.log(faltando.length ? '>>> COLUNAS NÃO ENCONTRADAS: ' + faltando.join(' | ')
                             : 'Todas as colunas essenciais foram encontradas.');

  if (mapa[norm_(COL_OPORT_JSON)] === undefined) {
    Logger.log('>>> Coluna "' + COL_OPORT_JSON + '" ainda não existe na planilha — a visão de Oportunidades ficará vazia até essa coluna ser criada (o n8n cria sozinho na primeira gravação, ou você pode criar o cabeçalho manualmente).');
  }

  var admins = getAdminEmails_();
  Logger.log(admins.length
    ? 'Aba "' + ADMIN_SHEET_NAME + '": ' + admins.length + ' admin(s) → ' + admins.join(', ')
    : '>>> Nenhum admin encontrado. Crie a aba "' + ADMIN_SHEET_NAME + '" com um e-mail por linha na coluna A, ou nenhum usuário terá acesso total.');

  var emailAtual = emailUsuarioAtual_();
  Logger.log('E-mail identificado rodando no editor (não reflete o Web App): ' + (emailAtual || '(vazio — normal ao rodar direto no editor)'));

  var t = new Date().getTime();
  var itens = lerLinhas_();
  var ms = new Date().getTime() - t;
  var bytes = JSON.stringify(itens).length;
  Logger.log('Linhas mapeadas: ' + itens.length + ' em ' + ms + 'ms — payload ' + Math.round(bytes / 1024) + ' KB');
  if (itens.length) Logger.log('Primeiro registro: ' + JSON.stringify(itens[0]).slice(0, 900));

  var op = consolidarOportunidades_();
  Logger.log('Oportunidades: ' + op.linhasComJson + ' de ' + op.linhasTotal + ' linhas com JSON válido, ' + op.areas.length + ' áreas com itens.');

  return { linhas: itens.length, kb: Math.round(bytes / 1024), faltando: faltando, admins: admins.length };
}

/* ========================= escrita ========================= */

/**
 * Grava a coluna "Comentários e Ajustes" casando id_transcricao.
 * Nunca usa índice de coluna fixo: a versão antiga escrevia na 16ª coluna, que
 * na v2 é "Insight Impacto Máx" — sobrescreveria dado do agente.
 *
 * Também aplica o filtro de permissão: quem não é admin só pode gravar
 * comentário em linha cujo "Analista (e-mail)" seja o próprio.
 */
function atualizarComentario(id, comentario) {
  try {
    var ctx = contextoUsuario_();
    if (!ctx.email) return { success: false, error: MSG_SEM_EMAIL_ };

    var sheet = getSheet_();
    var ultima = sheet.getLastRow();
    if (ultima < 2) return { success: false, error: 'Planilha sem dados.' };

    var mapa = mapaColunas_(sheet);
    var iId = mapa[norm_(COL_ID)];
    if (iId === undefined) return { success: false, error: 'Coluna "' + COL_ID + '" não encontrada.' };

    var iEmail = mapa[norm_(COL_EMAIL)];
    var iCom = mapa[norm_(COL_COMENT)];
    if (iCom === undefined) {
      iCom = sheet.getLastColumn();
      sheet.getRange(1, iCom + 1).setValue(COL_COMENT);
    }

    var largura = sheet.getLastColumn();
    var linhas = sheet.getRange(2, 1, ultima - 1, largura).getValues();
    for (var r = 0; r < linhas.length; r++) {
      if (txt_(linhas[r][iId]) === String(id)) {
        var emailLinha = iEmail === undefined ? '' : norm_(linhas[r][iEmail]);
        if (!ctx.admin && emailLinha !== ctx.email) {
          return { success: false, error: 'Você não tem permissão para comentar nesta consultoria.' };
        }
        sheet.getRange(r + 2, iCom + 1).setValue(comentario);
        return { success: true, linha: r + 2 };
      }
    }
    return { success: false, error: 'Monitoria ' + id + ' não encontrada.' };
  } catch (e) {
    return { success: false, error: String(e && e.message || e) };
  }
}

/** Compatibilidade com a versão antiga do frontend. */
function atualizarComentarioSheet(id, comentario) {
  return atualizarComentario(id, comentario);
}
