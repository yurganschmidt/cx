// =====================================================================
// CODE.GS - VERSÃO ATUALIZADA
// - leitura da Coluna W (Caso Crítico) + gravação "Sim." na Coluna T
// - leitura da coluna "Ciclo" para o filtro de ciclo no dashboard
// - Gestão de acessos Admin direto pela aba "Admins"
// - NOVO: fluxo de contestação para agentes não-administradores, com
//   ciclo de vida fechado (Aberta -> Em Análise -> Aceita/Recusada) numa
//   aba própria ("Contestacoes"), substituindo o antigo Google Form.
// =====================================================================

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
      .evaluate()
      .setTitle('Olist | Monitorias')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// =====================================================================
// Busca os e-mails de admin direto da aba "Admins".
// Única fonte de verdade de quem é administrador: usada tanto pelo
// dashboard (ehAdmin) quanto pelo fluxo de contestação (quem pode decidir).
// =====================================================================
function getAdminEmails() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Admins');

  if (!sheet) {
    // Fallback de segurança caso a aba "Admins" não seja encontrada
    return [];
  }

  const ultimaLinha = sheet.getLastRow();
  if (ultimaLinha < 2) return [];

  const valores = sheet.getRange(2, 1, ultimaLinha - 1, 1).getValues();

  return valores
    .map(linha => String(linha[0]).toLowerCase().trim())
    .filter(email => email !== "");
}

function _cols_() {
  return {
    LIDO_INDEX: 19,  // Coluna T (0-based)
    LIDO_NUM: 20,    // Coluna T (1-based)
    CRITICO_IDX: 22  // Coluna W (0-based)
  };
}

function _ehCritico_(valor) {
  var v = String(valor === undefined || valor === null ? '' : valor)
            .normalize("NFD").replace(/[̀-ͯ]/g, "")
            .trim().toLowerCase();
  if (v === '') return false;
  if (v === 'nao' || v === 'n' || v === '-' || v === 'false' || v === '0') return false;
  return true; // "sim", "critico", "x", "true", "1" ou qualquer marcação preenchida
}

function getDashboardData() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Monitorias');

    if (!sheet) {
      return { error: "Aba 'Monitorias' não foi encontrada na planilha." };
    }

    const COLS = _cols_();
    const data = sheet.getDataRange().getValues();
    const emailUsuario = Session.getActiveUser().getEmail().toLowerCase().trim();

    let parts = emailUsuario.split('@')[0].split('.');
    let nomeUsuario = parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
    if (!nomeUsuario) nomeUsuario = "Usuário";

    if (data.length <= 2) {
      return { userName: nomeUsuario, userEmail: emailUsuario, ehAdmin: false, data: [] };
    }

    const emailsAdmin = getAdminEmails();
    const ehAdmin = emailsAdmin.includes(emailUsuario);

    const headers = data[1].map(function(h) {
      return String(h).replace(/\r|\n/g, '').trim().toLowerCase();
    });

    const rows = data.slice(2);

    const idxChat = headers.findIndex(h => h.includes('chat') || h.includes('atendimento'));
    const idxData = headers.findIndex(h => h === 'data');
    const idxAgente = headers.findIndex(h => h.includes('agente'));
    const idxMotivo = headers.findIndex(h => h.includes('motivo do contato'));
    const idxSubmotivo = headers.findIndex(h => h.includes('submotivo'));
    const idxNota = headers.findIndex(h => h.includes('nota'));
    const idxFeedback = headers.findIndex(h => h === 'feedback');
    const idxOportunidades = headers.findIndex(h => h.includes('oportunidades'));
    const idxLideranca = headers.findIndex(h => h.includes('liderança') || h.includes('lider'));
    const idxStatus = headers.findIndex(h => h.includes('status'));
    const idxAplicada = headers.findIndex(h => h.includes('aplicada'));
    const idxDataFeedback = headers.findIndex(h => h.includes('data do feedback'));
    const idxSemana = headers.findIndex(h => h === 'semana');
    const idxCiclo = headers.findIndex(h => h.includes('ciclo'));
    const idxEmail = headers.findIndex(h => h.includes('e-mail') || h.includes('email'));

    // NOVO: mapa de contestações por ID de monitoria (N. do atendimento), lido uma única vez.
    const contestacoesMap = _mapaContestacoesPorMonitoria_();

    const jsonData = [];

    for (let i = 0; i < rows.length; i++) {
      let row = rows[i];
      let chatVal = idxChat !== -1 ? String(row[idxChat]).trim() : '';

      if (!chatVal || chatVal.toLowerCase().includes('chat') || chatVal.toLowerCase().includes('atendimento')) continue;

      let statusVal = idxStatus !== -1 ? String(row[idxStatus]).trim().toLowerCase() : '';
      let statusLimpo = statusVal.normalize("NFD").replace(/[̀-ͯ]/g, "");
      if (statusLimpo !== 'disponivel') continue;

      // Filtro de E-mail do Agente (RLS) — garante que o não-admin só recebe as próprias linhas
      if (!ehAdmin) {
        let emailLinha = idxEmail !== -1 ? String(row[idxEmail]).trim().toLowerCase() : '';
        if (emailLinha !== emailUsuario) continue;
      }

      let dateVal = idxData !== -1 ? row[idxData] : '';
      if (dateVal instanceof Date) {
        let day = String(dateVal.getDate()).padStart(2, '0');
        let month = String(dateVal.getMonth() + 1).padStart(2, '0');
        let year = String(dateVal.getFullYear()).slice(-2);
        dateVal = day + '/' + month + '/' + year;
      } else {
        dateVal = String(dateVal).trim();
        dateVal = dateVal.replace(/\/20(\d{2})/, '/$1').replace(/\/19(\d{2})/, '/$1');
      }

      let lidoRaw = row[COLS.LIDO_INDEX] !== undefined ? String(row[COLS.LIDO_INDEX]).trim().toLowerCase() : '';
      let lidoVal = (lidoRaw === 'sim' || lidoRaw === 'sim.') ? 'Sim' : 'Não';

      let criticoRaw = row[COLS.CRITICO_IDX] !== undefined ? String(row[COLS.CRITICO_IDX]).trim() : '';
      let ehCritico = _ehCritico_(criticoRaw);

      // NOVO: status/decisão da contestação (join com a aba Contestacoes)
      let contestacao = contestacoesMap[chatVal] || { status: 'Nenhuma' };

      jsonData.push({
        'N. do chat': chatVal,
        'Data': dateVal,
        'Agente': idxAgente !== -1 ? String(row[idxAgente]).trim() : '',
        'Motivo do contato': idxMotivo !== -1 ? String(row[idxMotivo]).trim() : '',
        'Submotivo do contato': idxSubmotivo !== -1 ? String(row[idxSubmotivo]).trim() : '',
        'Nota': idxNota !== -1 ? String(row[idxNota]).trim() : '',
        'Feedback': idxFeedback !== -1 ? String(row[idxFeedback]).trim() : '',
        'Oportunidades': idxOportunidades !== -1 ? String(row[idxOportunidades]).trim() : '',
        'Liderança': idxLideranca !== -1 ? String(row[idxLideranca]).trim() : '',
        'Status da monitoria': idxStatus !== -1 ? String(row[idxStatus]).trim() : '',
        'Avaliação aplicada?': idxAplicada !== -1 ? String(row[idxAplicada]).trim() : '',
        'Data do feedback ao agente': idxDataFeedback !== -1 ? String(row[idxDataFeedback]).trim() : '',
        'Semana': idxSemana !== -1 ? String(row[idxSemana]).trim() : '',
        'Ciclo': idxCiclo !== -1 ? String(row[idxCiclo]).trim() : '',
        'Lido': lidoVal,
        'Critico': ehCritico,
        'Motivo Critico': criticoRaw,
        'Contestacao': contestacao // NOVO
      });
    }

    return {
      userName: nomeUsuario,
      userEmail: emailUsuario,
      ehAdmin: ehAdmin,
      data: jsonData.reverse()
    };
  } catch(e) {
    return { error: "Erro no servidor Code.gs: " + e.message };
  }
}

/**
 * "N. do atendimento" NÃO é garantidamente único em Monitorias (a planilha
 * tem linhas duplicadas com o mesmo número, de execuções/migrações
 * antigas). Qualquer função que precise achar "a" linha de uma monitoria
 * por esse número sozinho corre o risco de pegar a linha errada. Este
 * helper prioriza a linha cujo e-mail bate com quem está chamando (mesmo
 * critério que já decide, em getDashboardData(), o que cada agente vê) e
 * só cai para a primeira ocorrência se não achar — usado por
 * marcarComoLidoSheet, _lerMonitoriaPorChat_ e _atualizarMonitoriaRevisada_
 * para não repetir essa lógica em cada uma.
 *
 * IMPORTANTE: isso resolve o problema para ações do próprio agente (onde
 * temos o e-mail dele pela sessão). Para updateFeedbackStatusOnSheet
 * (ação do admin, que pode não ser o dono da linha) esse desempate não se
 * aplica — a causa raiz real é ter linhas duplicadas na planilha, e o
 * ideal é higienizar/deduplicar "N. do atendimento" em Monitorias.
 */
function _encontrarLinhaMonitoria_(data, idxChat, idxEmail, chatId, preferEmail) {
  chatId = String(chatId || '').trim();
  preferEmail = String(preferEmail || '').trim().toLowerCase();
  let linhaFallback = -1;

  for (let i = 2; i < data.length; i++) {
    if (String(data[i][idxChat]).trim() !== chatId) continue;
    const rowNumber = i + 1;
    if (linhaFallback === -1) linhaFallback = rowNumber;
    if (preferEmail && idxEmail !== -1) {
      const emailLinha = String(data[i][idxEmail]).trim().toLowerCase();
      if (emailLinha === preferEmail) return rowNumber;
    }
  }

  return linhaFallback;
}

function marcarComoLidoSheet(chatId) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Monitorias');
    if (!sheet) return { success: false, error: "Aba 'Monitorias' não encontrada." };

    const data = sheet.getDataRange().getValues();
    const headers = data[1].map(h => String(h).trim().toLowerCase());
    const idxChat = headers.findIndex(h => h.includes('chat') || h.includes('atendimento'));
    const idxEmail = headers.findIndex(h => h.includes('e-mail') || h.includes('email'));

    if (idxChat === -1) return { success: false, error: "Coluna de atendimento não encontrada." };

    const emailUsuario = Session.getActiveUser().getEmail().toLowerCase().trim();
    const rowNumber = _encontrarLinhaMonitoria_(data, idxChat, idxEmail, chatId, emailUsuario);

    if (rowNumber === -1) return { success: false, error: "Atendimento não localizado na planilha." };

    sheet.getRange(rowNumber, _cols_().LIDO_NUM).setValue("Sim.");
    SpreadsheetApp.flush();
    return { success: true, chatId: chatId, valor: "Sim." };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// Ação do admin — não tem um e-mail de agente confiável para desempatar
// entre linhas duplicadas de "N. do atendimento" (o admin pode estar
// marcando a monitoria de outra pessoa). Continua com o mesmo risco
// residual de _encontrarLinhaMonitoria_ sem preferEmail: se houver linhas
// duplicadas, pega a primeira. A correção definitiva é deduplicar
// "N. do atendimento" em Monitorias.
function updateFeedbackStatusOnSheet(chatId, isChecked) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Monitorias');
    if (!sheet) return { success: false, error: "Aba 'Monitorias' não encontrada." };
    const data = sheet.getDataRange().getValues();
    const headers = data[1].map(h => String(h).trim().toLowerCase());
    const idxChat = headers.findIndex(h => h.includes('chat') || h.includes('atendimento'));
    if (idxChat === -1) return { success: false, error: "Coluna de atendimento não encontrada." };
    const valorStatus = isChecked ? "Sim" : "Não";
    for (let i = 2; i < data.length; i++) {
      if (String(data[i][idxChat]).trim() === String(chatId).trim()) {
        const idxAplicada = headers.findIndex(h => h.includes('aplicada'));
        sheet.getRange(i + 1, idxAplicada + 1).setValue(valorStatus);
        return { success: true, chatId: chatId, status: valorStatus };
      }
    }
    return { success: false, error: "Atendimento não localizado na planilha." };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function dispararFluxoN8N() {
  const url = "https://n8n.olist.com/webhook/trigger-sheets-monitor";
  const options = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify({
      "acionado_por": Session.getActiveUser().getEmail(),
      "origem": "Botão Dashboard Base Geral",
      "data": new Date().toLocaleString()
    })
  };
  try {
    UrlFetchApp.fetch(url, options);
    return { success: true };
  } catch(e) {
    return { error: e.message };
  }
}

function dispararFluxoN8NNovaAba() {
  const url = "https://n8n.olist.com/webhook/trigger-sheets-monitorias";
  const options = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify({
      "acionado_por": Session.getActiveUser().getEmail(),
      "origem": "Botão Nova Aba - Fluxo de Atualização",
      "data": new Date().toLocaleString()
    })
  };
  try {
    UrlFetchApp.fetch(url, options);
    SpreadsheetApp.getUi().alert("Fluxo de atualização disparado com sucesso!");
    return { success: true };
  } catch(e) {
    SpreadsheetApp.getUi().alert("Erro ao disparar fluxo: " + e.message);
    return { error: e.message };
  }
}

function abrirDashboard() {
  var url = "https://script.google.com/a/macros/olist.com/s/AKfycbx2nGggNCN2sAci-uI8xfGVIEV5ZGF6C9TPFiBgGczO-R68EhOEMspSCTiBYr1f_49K/exec";
  var html = "<script>window.open('" + url + "', '_blank');google.script.host.close();<\/script>";
  var interface = HtmlService.createHtmlOutput(html).setWidth(150).setHeight(1);
  SpreadsheetApp.getUi().showModalDialog(interface, "Abrindo Dashboard...");
}

/**
 * Aplica o Row-Level Security (RLS) ocultando linhas onde o e-mail da Coluna V
 * não corresponde ao e-mail da pessoa logada na conta Google.
 *
 * Esta é a versão canônica: usa getAdminEmails() (aba "Admins") como única
 * fonte de verdade de quem é administrador — a mesma usada pelo dashboard e
 * pelo fluxo de contestação. A versão antiga em RLS_Seguranca.gs, com uma
 * lista de admins fixa no código, deve ser removida de lá para não colidir
 * (duas funções de mesmo nome no projeto fazem só uma "vencer" em runtime,
 * silenciosamente, sem erro).
 *
 * NOTA: este mecanismo é independente do RLS por requisição feito em
 * getDashboardData() (que é o que realmente protege o Web App). Esta função
 * esconde linhas na planilha real, para quem quer que a execute.
 */
function aplicarRLS() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Monitorias");
  if (!sheet) return;

  const emailUsuario = Session.getActiveUser().getEmail().toLowerCase().trim();
  const emailsAdmin = getAdminEmails();

  const ultimaLinha = sheet.getLastRow();
  const primeiraLinhaDados = 3; // Linhas 1 e 2 são cabeçalhos

  if (ultimaLinha < primeiraLinhaDados) return;

  const quantidadeLinhas = ultimaLinha - primeiraLinhaDados + 1;
  const colunaEmailIndex = 22; // Coluna V

  if (emailsAdmin.includes(emailUsuario)) {
    sheet.showRows(primeiraLinhaDados, quantidadeLinhas);
    SpreadsheetApp.getUi().alert(`Bem-vindo, Admin (${emailUsuario})! Todas as linhas estão visíveis.`);
    return;
  }

  const rangeEmails = sheet.getRange(primeiraLinhaDados, colunaEmailIndex, quantidadeLinhas, 1).getValues();

  sheet.showRows(primeiraLinhaDados, quantidadeLinhas);

  for (let i = 0; i < rangeEmails.length; i++) {
    const emailLinha = rangeEmails[i][0].toString().toLowerCase().trim();
    const numeroLinhaAtual = i + primeiraLinhaDados;

    if (emailLinha !== "" && emailLinha !== emailUsuario) {
      sheet.hideRows(numeroLinhaAtual);
    }
  }

  SpreadsheetApp.getUi().alert(`Visão personalizada aplicada para: ${emailUsuario}`);
}

/**
 * Exibe todas as linhas da planilha
 */
function restaurarVisao() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Monitorias");
  if (sheet) {
    const ultimaLinha = sheet.getLastRow();
    if (ultimaLinha >= 3) {
      sheet.showRows(3, ultimaLinha - 2);
    }
  }
}

// =====================================================================
// NOVO — FLUXO DE CONTESTAÇÃO
//
// Substitui por completo o antigo Google Form + processarEnvioDoFormulario.
// Toda a contestação vive na aba "Contestacoes" (criada automaticamente),
// com ciclo de vida fechado: Aberta -> Em Análise -> Aceita | Recusada.
// Uma vez decidida (Aceita ou Recusada), a contestação nunca pode ser
// reaberta nem redecidida.
// =====================================================================

const CONTESTACAO_SHEET_NAME = 'Contestacoes';
const CONTESTACAO_HEADERS = [
  'ID Contestação', 'ID Monitoria', 'Agente', 'Email Agente', 'Data Contestação',
  'Motivo Contestação', 'Nota Original', 'Feedback Original', 'Oportunidades Original',
  'Status', 'Data da Análise', 'Responsável pela Análise', 'Decisão',
  'Justificativa da Decisão', 'Nova Nota', 'Novo Feedback', 'Novas Oportunidades',
  'Data da Revisão'
];

function _getOrCreateContestacoesSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONTESTACAO_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONTESTACAO_SHEET_NAME);
    sheet.getRange(1, 1, 1, CONTESTACAO_HEADERS.length).setValues([CONTESTACAO_HEADERS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function _contestacaoHeaderMap_(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h).trim().toLowerCase(); });
  const map = {};
  headers.forEach(function (h, i) { map[h] = i; });
  return map;
}

function _formatarDataBR_(valor) {
  if (valor instanceof Date) {
    const day = String(valor.getDate()).padStart(2, '0');
    const month = String(valor.getMonth() + 1).padStart(2, '0');
    const year = String(valor.getFullYear()).slice(-2);
    const hh = String(valor.getHours()).padStart(2, '0');
    const mm = String(valor.getMinutes()).padStart(2, '0');
    return day + '/' + month + '/' + year + ' ' + hh + ':' + mm;
  }
  return valor ? String(valor).trim() : '';
}

function _linhaContestacaoParaRegistro_(map, row, rowNumber) {
  return {
    rowNumber: rowNumber,
    map: map,
    id: String(row[map['id contestação']] || '').trim(),
    idMonitoria: String(row[map['id monitoria']] || '').trim(),
    agente: row[map['agente']],
    emailAgente: row[map['email agente']],
    status: String(row[map['status']] || '').trim() || 'Aberta',
    notaOriginal: row[map['nota original']],
    feedbackOriginal: row[map['feedback original']],
    oportunidadesOriginal: row[map['oportunidades original']]
  };
}

function _buscarContestacaoPorMonitoria_(sheet, chatId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const map = _contestacaoHeaderMap_(sheet);
  const idxMonitoria = map['id monitoria'];
  const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][idxMonitoria]).trim() === String(chatId).trim()) {
      return _linhaContestacaoParaRegistro_(map, values[i], i + 2);
    }
  }
  return null;
}

function _buscarContestacaoPorId_(sheet, contestacaoId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const map = _contestacaoHeaderMap_(sheet);
  const idxId = map['id contestação'];
  const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][idxId]).trim().toLowerCase() === String(contestacaoId).trim().toLowerCase()) {
      return _linhaContestacaoParaRegistro_(map, values[i], i + 2);
    }
  }
  return null;
}

// Mapa { idMonitoria: { status, motivo, decisao, ... } } lido uma única vez
// por chamada a getDashboardData(), para o "join" com a aba Monitorias.
function _mapaContestacoesPorMonitoria_() {
  const sheet = _getOrCreateContestacoesSheet_();
  const lastRow = sheet.getLastRow();
  const map = {};
  if (lastRow < 2) return map;

  const headerMap = _contestacaoHeaderMap_(sheet);
  const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

  values.forEach(function (row) {
    const chatId = String(row[headerMap['id monitoria']] || '').trim();
    if (!chatId) return;
    map[chatId] = {
      id: row[headerMap['id contestação']],
      status: String(row[headerMap['status']] || '').trim() || 'Aberta',
      motivo: row[headerMap['motivo contestação']],
      dataContestacao: _formatarDataBR_(row[headerMap['data contestação']]),
      decisao: row[headerMap['decisão']],
      justificativa: row[headerMap['justificativa da decisão']],
      novaNota: row[headerMap['nova nota']],
      novoFeedback: row[headerMap['novo feedback']],
      novasOportunidades: row[headerMap['novas oportunidades']],
      dataRevisao: _formatarDataBR_(row[headerMap['data da revisão']]),
      responsavelAnalise: row[headerMap['responsável pela análise']],
      dataAnalise: _formatarDataBR_(row[headerMap['data da análise']])
    };
  });

  return map;
}

/**
 * Busca a linha da monitoria por N. do atendimento, usando
 * _encontrarLinhaMonitoria_ para priorizar a linha de `preferEmail`
 * quando houver mais de uma linha com o mesmo número (ver comentário
 * daquele helper).
 */
function _lerMonitoriaPorChat_(chatId, preferEmail) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Monitorias');
  if (!sheet) return null;

  const data = sheet.getDataRange().getValues();
  const headers = data[1].map(h => String(h).trim().toLowerCase());
  const idxChat = headers.findIndex(h => h.includes('chat') || h.includes('atendimento'));
  const idxAgente = headers.findIndex(h => h.includes('agente'));
  const idxNota = headers.findIndex(h => h.includes('nota'));
  const idxFeedback = headers.findIndex(h => h === 'feedback');
  const idxOportunidades = headers.findIndex(h => h.includes('oportunidades'));
  const idxEmail = headers.findIndex(h => h.includes('e-mail') || h.includes('email'));

  if (idxChat === -1) return null;

  const rowNumber = _encontrarLinhaMonitoria_(data, idxChat, idxEmail, chatId, preferEmail);
  if (rowNumber === -1) return null;

  const row = data[rowNumber - 1];
  return {
    agente: idxAgente !== -1 ? String(row[idxAgente]).trim() : '',
    nota: idxNota !== -1 ? row[idxNota] : '',
    feedback: idxFeedback !== -1 ? row[idxFeedback] : '',
    oportunidades: idxOportunidades !== -1 ? row[idxOportunidades] : '',
    emailLinha: idxEmail !== -1 ? String(row[idxEmail]).trim().toLowerCase() : ''
  };
}

function _atualizarMonitoriaRevisada_(chatId, novaNota, novoFeedback, novasOportunidades, preferEmail) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Monitorias');
  if (!sheet) {
    Logger.log('_atualizarMonitoriaRevisada_: aba Monitorias não encontrada');
    return false;
  }

  const data = sheet.getDataRange().getValues();
  const headers = data[1].map(h => String(h).trim().toLowerCase());
  const idxChat = headers.findIndex(h => h.includes('chat') || h.includes('atendimento'));
  const idxEmail = headers.findIndex(h => h.includes('e-mail') || h.includes('email'));
  const idxNota = headers.findIndex(h => h.includes('nota'));
  const idxFeedback = headers.findIndex(h => h === 'feedback');
  const idxOportunidades = headers.findIndex(h => h.includes('oportunidades'));

  Logger.log('_atualizarMonitoriaRevisada_: chatId=%s idxChat=%s idxNota=%s idxFeedback=%s idxOportunidades=%s idxEmail=%s preferEmail=%s headers=%s',
    chatId, idxChat, idxNota, idxFeedback, idxOportunidades, idxEmail, preferEmail, JSON.stringify(headers));

  if (idxChat === -1) return false;

  const rowNumber = _encontrarLinhaMonitoria_(data, idxChat, idxEmail, chatId, preferEmail);
  Logger.log('_atualizarMonitoriaRevisada_: linha encontrada para chatId=%s -> rowNumber=%s', chatId, rowNumber);
  if (rowNumber === -1) return false;

  // Escreve sempre na mesma célula "Feedback" que o n8n usa: isso é o que
  // garante que o n8n nunca mais reprocessará esta linha (seu Filter já
  // ignora qualquer linha com Feedback preenchido).
  if (idxNota !== -1) sheet.getRange(rowNumber, idxNota + 1).setValue(novaNota);
  if (idxFeedback !== -1) sheet.getRange(rowNumber, idxFeedback + 1).setValue(novoFeedback);
  if (idxOportunidades !== -1 && novasOportunidades) {
    sheet.getRange(rowNumber, idxOportunidades + 1).setValue(novasOportunidades);
  }
  Logger.log('_atualizarMonitoriaRevisada_: escrita concluída na linha %s (idxNota=%s valor=%s)', rowNumber, idxNota, novaNota);
  return true;
}

/**
 * Chamada pelo agente (não-admin) ao clicar em "Discordar do feedback".
 * A identidade do agente vem sempre da sessão do Google — nunca de um
 * parâmetro vindo do navegador — e nota/feedback originais são lidos ao
 * vivo da planilha, também nunca confiando no que o cliente mandou.
 */
function abrirContestacao(chatId, motivo) {
  try {
    chatId = String(chatId || '').trim();
    motivo = String(motivo || '').trim();

    if (!chatId) return { success: false, error: 'Monitoria não identificada.' };
    if (!motivo) return { success: false, error: 'Descreva o motivo da contestação.' };
    if (motivo.length < 10) {
      return { success: false, error: 'Explique melhor o motivo (mínimo 10 caracteres).' };
    }

    const emailAgente = Session.getActiveUser().getEmail().toLowerCase().trim();
    if (!emailAgente) return { success: false, error: 'Não foi possível identificar o usuário logado.' };

    const monitoria = _lerMonitoriaPorChat_(chatId, emailAgente);
    if (!monitoria) return { success: false, error: 'Monitoria não encontrada na planilha.' };

    const emailsAdmin = getAdminEmails();
    const ehAdmin = emailsAdmin.includes(emailAgente);
    if (!ehAdmin && monitoria.emailLinha && monitoria.emailLinha !== emailAgente) {
      return { success: false, error: 'Você não tem permissão para contestar esta monitoria.' };
    }

    const sheet = _getOrCreateContestacoesSheet_();
    const existente = _buscarContestacaoPorMonitoria_(sheet, chatId);
    if (existente) {
      return {
        success: false,
        error: 'Já existe uma contestação registrada para esta monitoria.',
        status: existente.status
      };
    }

    const id = 'CT-' + Utilities.getUuid().split('-')[0].toUpperCase();
    const agora = new Date();

    sheet.appendRow([
      id, chatId, monitoria.agente, emailAgente, agora,
      motivo, monitoria.nota, monitoria.feedback, monitoria.oportunidades,
      'Aberta', '', '', '', '', '', '', '', ''
    ]);

    return {
      success: true,
      contestacao: { id: id, status: 'Aberta', dataContestacao: _formatarDataBR_(agora), motivo: motivo }
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Só admins (Lari/Qualidade) podem mover uma contestação para "Em Análise".
 * Só é permitido a partir do estado "Aberta".
 */
function marcarContestacaoEmAnalise(contestacaoId) {
  try {
    const emailUsuario = Session.getActiveUser().getEmail().toLowerCase().trim();
    if (!getAdminEmails().includes(emailUsuario)) {
      return { success: false, error: 'Apenas a equipe de Qualidade pode gerenciar contestações.' };
    }

    const sheet = _getOrCreateContestacoesSheet_();
    const registro = _buscarContestacaoPorId_(sheet, contestacaoId);
    if (!registro) return { success: false, error: 'Contestação não encontrada.' };
    if (registro.status !== 'Aberta') {
      return { success: false, error: 'Só é possível marcar como "Em Análise" uma contestação com status "Aberta". Status atual: ' + registro.status };
    }

    sheet.getRange(registro.rowNumber, registro.map['status'] + 1).setValue('Em Análise');
    return { success: true, status: 'Em Análise' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Decide uma contestação (Aceita ou Recusada). Só admins. Ciclo fechado:
 * uma contestação já decidida (Aceita/Recusada) nunca pode ser redecidida.
 * Se aceita, atualiza Nota/Feedback/Oportunidades "atuais" em Monitorias —
 * os valores originais já estão preservados na própria linha desta aba,
 * capturados no momento em que a contestação foi aberta.
 */
function decidirContestacao(contestacaoId, decisao, justificativa, novaNota, novoFeedback, novasOportunidades) {
  try {
    const emailUsuario = Session.getActiveUser().getEmail().toLowerCase().trim();
    if (!getAdminEmails().includes(emailUsuario)) {
      return { success: false, error: 'Apenas a equipe de Qualidade pode decidir contestações.' };
    }

    decisao = String(decisao || '').trim();
    if (decisao !== 'Aceita' && decisao !== 'Recusada') {
      return { success: false, error: 'Decisão inválida. Use "Aceita" ou "Recusada".' };
    }

    justificativa = String(justificativa || '').trim();
    if (!justificativa) {
      return { success: false, error: 'Informe a justificativa da decisão.' };
    }

    const sheet = _getOrCreateContestacoesSheet_();
    const registro = _buscarContestacaoPorId_(sheet, contestacaoId);
    Logger.log('decidirContestacao: id=%s decisao=%s registroEncontrado=%s idMonitoria=%s statusAtual=%s emailAgente=%s',
      contestacaoId, decisao, !!registro, registro && registro.idMonitoria, registro && registro.status, registro && registro.emailAgente);
    if (!registro) return { success: false, error: 'Contestação não encontrada.' };
    if (registro.status === 'Aceita' || registro.status === 'Recusada') {
      return {
        success: false,
        error: 'Esta contestação já foi encerrada (' + registro.status + ') e não pode ser reavaliada.'
      };
    }

    const agora = new Date();
    const map = registro.map;
    const row = registro.rowNumber;

    sheet.getRange(row, map['status'] + 1).setValue(decisao);
    sheet.getRange(row, map['data da análise'] + 1).setValue(agora);
    sheet.getRange(row, map['responsável pela análise'] + 1).setValue(emailUsuario);
    sheet.getRange(row, map['decisão'] + 1).setValue(decisao);
    sheet.getRange(row, map['justificativa da decisão'] + 1).setValue(justificativa);

    if (decisao === 'Aceita') {
      const notaFinal = (novaNota !== undefined && novaNota !== null && String(novaNota).trim() !== '')
        ? novaNota : registro.notaOriginal;
      const feedbackFinal = (novoFeedback && String(novoFeedback).trim() !== '')
        ? novoFeedback : registro.feedbackOriginal;
      // "Novas Oportunidades" só existe quando a Lari explicitamente digita
      // algo novo. Sem isso, cair de volta nas oportunidades ORIGINAIS e
      // gravá-las como se fossem "novas" só confunde o agente (parece que
      // surgiu do nada). O menu de aceitar hoje nem pergunta esse campo —
      // ele fica vazio, e o painel de "Contestação aceita" simplesmente não
      // mostra a linha de oportunidades quando está vazio.
      const oportunidadesFinal = (novasOportunidades && String(novasOportunidades).trim() !== '')
        ? novasOportunidades : '';

      sheet.getRange(row, map['nova nota'] + 1).setValue(notaFinal);
      sheet.getRange(row, map['novo feedback'] + 1).setValue(feedbackFinal);
      if (oportunidadesFinal) {
        sheet.getRange(row, map['novas oportunidades'] + 1).setValue(oportunidadesFinal);
      }
      sheet.getRange(row, map['data da revisão'] + 1).setValue(agora);

      const atualizouMonitoria = _atualizarMonitoriaRevisada_(registro.idMonitoria, notaFinal, feedbackFinal, oportunidadesFinal, registro.emailAgente);
      Logger.log('decidirContestacao: _atualizarMonitoriaRevisada_(idMonitoria=%s, notaFinal=%s) retornou %s',
        registro.idMonitoria, notaFinal, atualizouMonitoria);
      if (!atualizouMonitoria) {
        return {
          success: true,
          status: decisao,
          aviso: 'A contestação foi aceita e registrada, mas a linha da monitoria "' + registro.idMonitoria +
            '" não foi localizada na aba Monitorias para atualizar Nota/Feedback. Atualize essa linha manualmente.'
        };
      }
    }

    return { success: true, status: decisao };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ---------------------------------------------------------------------
// Menu da planilha para a Lari decidir contestações sem precisar de outra
// tela: ela trabalha direto na aba "Contestacoes".
// ---------------------------------------------------------------------
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Contestações')
    .addItem('Marcar como "Em Análise"...', 'menuMarcarEmAnalise_')
    .addItem('Aceitar contestação...', 'menuAceitarContestacao_')
    .addItem('Recusar contestação...', 'menuRecusarContestacao_')
    .addToUi();
}

function menuMarcarEmAnalise_() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.prompt('Em Análise', 'ID da Contestação (ex: CT-AB12CD34):', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  const r = marcarContestacaoEmAnalise(resp.getResponseText().trim());
  ui.alert(r.success ? 'Contestação marcada como "Em Análise".' : 'Erro: ' + r.error);
}

function menuAceitarContestacao_() {
  const ui = SpreadsheetApp.getUi();

  const idResp = ui.prompt('Aceitar contestação', 'ID da Contestação:', ui.ButtonSet.OK_CANCEL);
  if (idResp.getSelectedButton() !== ui.Button.OK) return;
  const id = idResp.getResponseText().trim();

  const justResp = ui.prompt('Justificativa', 'Justificativa da decisão (obrigatório):', ui.ButtonSet.OK_CANCEL);
  if (justResp.getSelectedButton() !== ui.Button.OK) return;
  const justificativa = justResp.getResponseText().trim();

  const notaResp = ui.prompt('Nova nota', 'Nova nota (deixe em branco para manter a original):', ui.ButtonSet.OK_CANCEL);
  if (notaResp.getSelectedButton() !== ui.Button.OK) return;
  const novaNota = notaResp.getResponseText().trim();

  const feedbackResp = ui.prompt('Novo feedback', 'Novo feedback (deixe em branco para manter o original):', ui.ButtonSet.OK_CANCEL);
  if (feedbackResp.getSelectedButton() !== ui.Button.OK) return;
  const novoFeedback = feedbackResp.getResponseText().trim();

  const r = decidirContestacao(id, 'Aceita', justificativa, novaNota, novoFeedback, '');
  if (!r.success) {
    ui.alert('Erro: ' + r.error);
  } else if (r.aviso) {
    ui.alert('⚠️ ' + r.aviso);
  } else {
    ui.alert('Contestação aceita e monitoria atualizada.');
  }
}

function menuRecusarContestacao_() {
  const ui = SpreadsheetApp.getUi();

  const idResp = ui.prompt('Recusar contestação', 'ID da Contestação:', ui.ButtonSet.OK_CANCEL);
  if (idResp.getSelectedButton() !== ui.Button.OK) return;
  const id = idResp.getResponseText().trim();

  const justResp = ui.prompt('Justificativa', 'Explique por que a contestação não foi aceita (obrigatório):', ui.ButtonSet.OK_CANCEL);
  if (justResp.getSelectedButton() !== ui.Button.OK) return;
  const justificativa = justResp.getResponseText().trim();

  const r = decidirContestacao(id, 'Recusada', justificativa, '', '', '');
  ui.alert(r.success ? 'Contestação recusada.' : 'Erro: ' + r.error);
}
