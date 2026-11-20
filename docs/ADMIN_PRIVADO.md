# Admin privado: Google Sheet + links Hacoo

## Objetivo

Manter os links Hacoo, perfis e registos operacionais fora do frontend publico, mas acessiveis ao dono no telemovel e no desktop.

## Planilha existente

Foi analisado o ficheiro `planilha_revenda_hacoo_v2 (1).xlsx` e alinhado com a Google Sheet:

- `https://docs.google.com/spreadsheets/d/1bxN7ClOM1twl4lLWsJyar0wdMsnmn1v2rsA8R0w3Wfs/edit?usp=sharing`
- spreadsheet id: `1bxN7ClOM1twl4lLWsJyar0wdMsnmn1v2rsA8R0w3Wfs`

Separadores encontrados:

- `Dados`
- `Dashboard`
- `Gestão do Dinheiro`
- `LOJAS`
- `PESSOAL`

Os campos da folha `Dados` ja cobrem bem a tua operacao manual, incluindo:

- `ORDER NO.`
- `EMAIL DE NOTIFICAÇÃO`
- `SENHA`
- `EMAIL HACOO CONTA`
- `TELEFONE USADO`
- `ITEM`
- `MARCA`
- `MODELO`
- `TAMANHO / MODELO`
- `STATUS`
- `OBS`

## Estrutura adotada

Mantem-se a tua folha atual e acrescentam-se apenas os separadores novos necessarios:

### `LINKS`

Usado para guardar links Hacoo por `slug` sem os expor no site publico.

Cabecalhos:

- `slug`
- `name`
- `buyLink`
- `active`
- `platform`
- `category`
- `brand`
- `updatedAt`
- `notes`

### `PEDIDOS_ST`

Usado para registar pedidos aprovados vindos do catalogo.

Cabecalhos:

- `createdAt`
- `orderCode`
- `customerName`
- `customerPhone`
- `itemsText`
- `estimatedTotalEur`
- `status`
- `sourceUrl`
- `notes`

### `PESSOAL`

Ja existe e fica como folha para guardar os perfis/contas criados quando compras a partir de um novo utilizador do telemovel.

O script novo foi alinhado com os cabecalhos reais dessa folha, por isso consegue acrescentar linhas sem inventar um formato paralelo.

## O que ficou implementado no repositorio

### 1. Migracao dos links privados

Script:

- [scripts/migrate-private-links.mjs](file:///C:/SmartThings/scripts/migrate-private-links.mjs)

O script:

1. le `imagens/telegram_manifest.json`
2. exporta os `buyLink` para `_local/private_admin/links_sheet_import.csv`
3. remove `buyLink` e `hasBuyLink` do manifest publico

Comando:

```bash
npm run private-links:migrate
```

### 2. Importador atualizado

- [import_telegram_export.py](file:///C:/SmartThings/import_telegram_export.py)

Quando corres o import com `--apply`, ele agora:

1. gera `_local/private_admin/links_sheet_import.csv`
2. remove os links privados do manifest publico antes de gravar

Opcao:

```bash
python import_telegram_export.py --export-dir "CAMINHO_DO_CHATEXPORT" --apply
```

### 3. Google Apps Script privado

- [google_apps_script/admin_private.gs](file:///C:/SmartThings/google_apps_script/admin_private.gs)

Funcoes principais:

- `setupPrivateAdminSheets()`
- `appendApprovedOrder(order)` escreve em `PEDIDOS_ST`
- `appendHacooProfile(profile)`
- `upsertPrivateLink(linkData)` escreve em `LINKS`

Alinhamento real:

- usa por defeito a spreadsheet `1bxN7ClOM1twl4lLWsJyar0wdMsnmn1v2rsA8R0w3Wfs`
- web app atual do Apps Script:
  - `https://script.google.com/macros/s/AKfycbx1hfdnTvmon6-Ek3--ggt13WYTeCRAU805vuBuabKSMVEcfabreoWmk5vlYP9brc2Q7A/exec`
- valida a existencia de `Dados` e `PESSOAL`
- cria apenas `LINKS` e `PEDIDOS_ST` se ainda nao existirem

Script Properties necessarias:

- `SMARTTHINGS_PRIVATE_SPREADSHEET_ID`
- `SMARTTHINGS_ADMIN_TOKEN` (so se quiseres usar `doPost`)

## Fluxo recomendado para ti

1. Abrir a tua Google Sheet atual.
2. Adicionar os separadores `LINKS` e `PEDIDOS_ST`.
3. Correr `npm run private-links:migrate`.
4. Importar `_local/private_admin/links_sheet_import.csv` para o separador `LINKS`.
5. Continuar a usar `Dados` para a operacao principal e `PESSOAL` para emails/senhas/telefone dos perfis novos.

## Se a folha `LINKS` aparecer vazia

Isso significa normalmente que:

- o separador `LINKS` foi criado
- mas o CSV privado ainda nao foi importado

O ficheiro correto e:

- [links privados para a Google Sheet](computer://c:\SmartThings\_local\private_admin\links_sheet_import.csv)

Estado atual observado:

- o CSV privado tem dados
- total de linhas: `899` incluindo cabecalho
- agora inclui tambem a coluna `refCode`, por exemplo `ST-1A2B3C`

Ou seja, a tua folha vazia nao quer dizer que os links se perderam. Quer apenas dizer que ainda falta importar esse CSV para a aba `LINKS`.

## Nota importante

GitHub Pages nao consegue proteger segredos no frontend. Por isso:

- os links Hacoo nao devem ficar no manifest publico
- qualquer acesso privado deve viver na tua Google Sheet privada ou num backend/controlador teu
- o URL do Apps Script pode ficar configurado, mas o envio automatico no frontend publico nao deve ser ativado se exigir token no browser

Esta foi a opcao adotada.
