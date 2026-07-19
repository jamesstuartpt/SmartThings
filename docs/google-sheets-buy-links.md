# Google Sheets + Compra Oculta

Este fluxo deixa o site com botao `Comprar` sem publicar o link real no
`telegram_manifest.json`.

## Como Funciona

1. O `telegram_extract.py` continua a gerar o catalogo do site.
2. O mesmo extrator passa a gerar um CSV para Google Sheets:
   `google_sheets_buy_links.csv`
3. Tu importas esse CSV para uma folha `buy_links`.
4. Um `Google Apps Script` recebe `?slug=...`, procura o link na sheet e faz o
   redirect.
5. O site mostra `Comprar` apenas nos produtos que tiverem `hasBuyLink: true`.
6. Se o produto nao tiver link configurado, o botao continua a abrir o WhatsApp.

## Ficheiros Novos

- `site_config.js`: URL do Web App do Apps Script
- `google_apps_script/buy_redirect.gs`: codigo do redirect
- `docs/google-sheets-buy-links.md`: este guia

## CSV Gerado Pelo Extrator

Quando corres o extrator, ele passa a gerar:

- `captions.csv`
- `google_sheets_buy_links.csv`

Colunas do CSV para a sheet:

- `slug`
- `name`
- `category`
- `brandSlug`
- `brandLabel`
- `modelSlug`
- `modelLabel`
- `buyLink`
- `active`
- `latestTs`

## Estrutura Recomendada Da Sheet

Cria uma sheet chamada `buy_links` com o header na linha 1:

```csv
slug,name,category,brandSlug,brandLabel,modelSlug,modelLabel,buyLink,active,latestTs
```

Notas:

- `slug` tem de ficar exatamente igual ao do CSV.
- `buyLink` e o link real de compra.
- `active` pode ser `TRUE` ou `FALSE`.
- Podes editar apenas `buyLink` e `active` se quiseres manter o resto igual.

## Deploy Do Google Apps Script

1. Abre [Google Apps Script](https://script.google.com/).
2. Cria um projeto novo.
3. Cola o conteudo de `google_apps_script/buy_redirect.gs`.
4. Substitui:
   - `SPREADSHEET_ID`
   - `SHEET_NAME` se quiseres outro nome
5. Clica em `Deploy` > `New deployment`.
6. Escolhe `Web app`.
7. Executa como: `Me`
8. Quem tem acesso: `Anyone`
9. Copia a URL final do Web App.

## Ligar Ao Site

Edita `site_config.js` e cola a URL no campo:

```js
window.SMARTTHINGS_CONFIG = {
  buyRedirectBaseUrl: "https://script.google.com/macros/s/AKfycb.../exec",
};
```

Depois faz `push` para atualizar o GitHub Pages.

## Fluxo Recomendado Em Cada Export

1. Extrai o `ChatExport` do Telegram.
2. Corre o `telegram_extract.py` como ja fazes hoje.
3. Abre `google_sheets_buy_links.csv`.
4. Importa para a tua Google Sheet.
5. Confirma os `buyLink` e `active`.
6. Publica o site.

## Limite Importante

Isto evita expor os links no catalogo publico e no `telegram_manifest.json`.
Mesmo assim, como existe redirect publico, uma pessoa determinada ainda pode
descobrir o destino final ao seguir o pedido de rede. Portanto isto serve para
`nao deixar o link visivel no site`, nao para sigilo absoluto.
