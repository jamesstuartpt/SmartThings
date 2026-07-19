# Cloudflare Worker + Google Sheets

Este fluxo substitui o `Google Apps Script` por um `Cloudflare Worker`, evitando
o aviso de app suspeita do Google e mantendo os links fora do
`telegram_manifest.json`.

## Como Funciona

1. O `telegram_extract.py` continua a gerar o catalogo do site.
2. O mesmo extrator continua a gerar `google_sheets_buy_links.csv`.
3. Tu importas esse CSV para a tua Google Sheet, na aba `LINKS`.
4. O `Cloudflare Worker` recebe `?slug=...`, vai ler a aba `LINKS` e faz o
   redirect para o `buyLink`.
5. O site mostra `Comprar` apenas nos produtos com `hasBuyLink: true`.

## Ficheiros

- `cloudflare_worker/buy_redirect_worker.js`: codigo do Worker
- `cloudflare_worker/wrangler.example.jsonc`: exemplo de config
- `site_config.js`: URL publica do redirect

## Requisito Da Google Sheet

Para o Worker conseguir ler a tua folha sem login:

1. Abre a tua Google Sheet.
2. Vai a `Partilhar`.
3. Muda para `Qualquer pessoa com o link`.
4. Permissao: `Leitor`.
5. Mantem a aba com o nome `LINKS`.

O Worker usa estas colunas:

```csv
slug,name,category,brandSlug,brandLabel,modelSlug,modelLabel,buyLink,active,latestTs
```

As colunas obrigatorias sao:

- `slug`
- `buyLink`

## Deploy Rapido Pelo Dashboard

1. Abre [Cloudflare Workers](https://dash.cloudflare.com/).
2. Entra em `Workers & Pages`.
3. Clica em `Create application`.
4. Escolhe `Create Worker`.
5. Da um nome como `smartthings-buy-redirect`.
6. Abre o editor do Worker.
7. Cola o conteudo de `cloudflare_worker/buy_redirect_worker.js`.
8. Em `Settings` > `Variables`, cria:
   - `GOOGLE_SHEET_ID` = `17Wye0UCdfJe6y6tnXKmyU7DnFggmqefO78bK485gln8`
   - `GOOGLE_SHEET_NAME` = `LINKS`
   - `FALLBACK_WHATSAPP_URL` =
     `https://api.whatsapp.com/send?phone=351927515217&text=Ol%C3%A1!%20Vi%20o%20cat%C3%A1logo%20e%20preciso%20de%20ajuda.`
   - `BUY_REDIRECT_CACHE_TTL` = `300`
9. Faz `Deploy`.
10. Copia a URL final, por exemplo:
    `https://smartthings-buy-redirect.<teu-subdominio>.workers.dev`

Notas:

- O codigo ja traz por defeito o `GOOGLE_SHEET_ID` e a aba `LINKS`.
- Portanto, se nao quiseres configurar variaveis, o Worker continua a funcionar
  desde que uses esta mesma Sheet publica.

## Ligar Ao Site

Quando tiveres a URL do Worker, cola em `site_config.js`:

```js
window.SMARTTHINGS_CONFIG = Object.assign(
  {
    buyRedirectBaseUrl:
      "https://smartthings-buy-redirect.<teu-subdominio>.workers.dev",
  },
  window.SMARTTHINGS_CONFIG || {},
);
```

Depois faz `push` para atualizar o `GitHub Pages`.

## Teste

Depois do deploy, testa assim:

```text
https://smartthings-buy-redirect.<teu-subdominio>.workers.dev?slug=polo_ralph_lauren
```

Se estiver tudo certo, o Worker responde com `302` e abre o `buyLink`.

## Fluxo Em Cada Nova Exportacao

1. Extrai o novo `ChatExport`.
2. Corre o `telegram_extract.py`.
3. Importa `google_sheets_buy_links.csv` para a aba `LINKS`.
4. Publica o site normalmente.

Nao precisas mexer no Worker se o `slug` continuar igual e a Sheet for a mesma.

## Limite Importante

Isto esconde os links do catalogo publico e evita a pagina de aviso do Apps
Script. Mesmo assim, o destino final continua a ser observavel por quem seguir o
pedido de rede no browser.
