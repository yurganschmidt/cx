#!/usr/bin/env bash
# Conta quantas vezes o workflow "Gerador de Chamado N2" foi usado de
# verdade (chamadas POST reais), desde o lançamento, usando a API REST
# do n8n. Ignora as execuções disparadas pelo preflight CORS (OPTIONS),
# que senão dobram a contagem.
#
# Pré-requisitos:
#   - curl e jq instalados
#   - uma API key do n8n: Settings > n8n API > Create an API key
#   - o ID do workflow, visível na URL do editor:
#       https://n8n.olist.com/workflow/<ID_DO_WORKFLOW>/...
#
# Uso:
#   N8N_URL="https://n8n.olist.com" \
#   N8N_API_KEY="sua_api_key" \
#   WORKFLOW_ID="id_do_workflow" \
#   ./n8n-contar-execucoes.sh

set -euo pipefail

: "${N8N_URL:?defina N8N_URL, ex: https://n8n.olist.com}"
: "${N8N_API_KEY:?defina N8N_API_KEY (Settings > n8n API > Create an API key)}"
: "${WORKFLOW_ID:?defina WORKFLOW_ID (ID do workflow, visível na URL do editor)}"

command -v jq >/dev/null 2>&1 || { echo "Este script precisa do 'jq' instalado." >&2; exit 1; }

cursor=""
total_execucoes=0
total_reais=0
total_sucesso=0
total_erro=0

echo "Consultando execuções do workflow $WORKFLOW_ID em $N8N_URL ..." >&2
echo "(pode levar um tempo se houver muito histórico)" >&2

while : ; do
  url="$N8N_URL/api/v1/executions?workflowId=$WORKFLOW_ID&limit=100&includeData=true"
  if [[ -n "$cursor" ]]; then
    url="$url&cursor=$cursor"
  fi

  resp=$(curl -sS -H "X-N8N-API-KEY: $N8N_API_KEY" "$url")

  # Aborta cedo se a API devolver erro (ex: key inválida) em vez de dados
  if ! echo "$resp" | jq -e '.data' >/dev/null 2>&1; then
    echo "Erro ao consultar a API do n8n:" >&2
    echo "$resp" >&2
    exit 1
  fi

  page_count=$(echo "$resp" | jq '.data | length')
  total_execucoes=$((total_execucoes + page_count))

  # Execução "real" = passou pelo node do Agente (só acontece no fluxo
  # do POST; o preflight OPTIONS nunca chega nesse node)
  page_reais=$(echo "$resp" | jq '[.data[] | select(.data.resultData.runData["Agente - Extrair Dados do Chamado"] != null)] | length')
  total_reais=$((total_reais + page_reais))

  page_sucesso=$(echo "$resp" | jq '[.data[] | select(.data.resultData.runData["Agente - Extrair Dados do Chamado"] != null and .status == "success")] | length')
  total_sucesso=$((total_sucesso + page_sucesso))

  page_erro=$(echo "$resp" | jq '[.data[] | select(.data.resultData.runData["Agente - Extrair Dados do Chamado"] != null and .status == "error")] | length')
  total_erro=$((total_erro + page_erro))

  cursor=$(echo "$resp" | jq -r '.nextCursor // empty')
  if [[ -z "$cursor" ]]; then
    break
  fi
done

echo ""
echo "Total de execuções no histórico (inclui preflight OPTIONS): $total_execucoes"
echo "Total de chamados gerados de verdade (POST real):           $total_reais"
echo "  - com sucesso:  $total_sucesso"
echo "  - com erro:     $total_erro"
