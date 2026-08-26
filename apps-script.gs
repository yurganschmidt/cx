/**
 * Registro de presença dos treinamentos coletivos → Google Sheets
 *
 * Como usar:
 * 1. Crie uma planilha no Google Sheets com uma aba chamada "Presencas".
 *    Linha 1 (cabeçalho): Data e hora | Tema | CNPJ
 * 2. Copie o ID da planilha (o trecho entre /d/ e /edit na URL) em SHEET_ID.
 * 3. Extensões → Apps Script, cole este arquivo, salve.
 * 4. Implantar → Nova implantação → Tipo: App da Web
 *    Executar como: Eu | Quem pode acessar: Qualquer pessoa
 * 5. Copie a URL /exec gerada: é o "endpoint" das duas telas (tela.html e presenca.html).
 */

const SHEET_ID = 'COLE_O_ID_DA_PLANILHA_AQUI';
const SHEET_NAME = 'Presencas';

function sheet() {
  return SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const p = (e && e.parameter) || {};
  const cnpj = String(p.cnpj || '').trim();
  if (!cnpj) return json({ ok: false, error: 'cnpj vazio' });
  sheet().appendRow([new Date(), String(p.tema || 'Não informado'), cnpj]);
  return json({ ok: true });
}

function reply(obj, callback) {
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + JSON.stringify(obj) + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return json(obj);
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  const cb = p.callback ? String(p.callback) : '';

  if (p.action === 'save') {
    const cnpj = String(p.cnpj || '').trim();
    if (!cnpj) return reply({ ok: false, error: 'cnpj vazio' }, cb);
    sheet().appendRow([new Date(), String(p.tema || 'Não informado'), cnpj]);
    return reply({ ok: true }, cb);
  }

  if (p.action === 'ping') {
    const nome = SpreadsheetApp.openById(SHEET_ID).getName();
    return reply({ ok: true, planilha: nome }, cb);
  }

  if (p.action === 'count') {
    const rows = sheet().getDataRange().getValues().slice(1);
    const hoje = new Date().toDateString();
    const tema = String(p.tema || '');
    const n = rows.filter(function (r) {
      if (!r[0]) return false;
      const mesmoDia = new Date(r[0]).toDateString() === hoje;
      const mesmoTema = !tema || String(r[1]) === tema;
      return mesmoDia && mesmoTema;
    }).length;
    return reply({ count: n }, cb);
  }
  return reply({ ok: true }, cb);
}
