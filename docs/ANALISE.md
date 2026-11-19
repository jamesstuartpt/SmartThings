# Analise do projeto Smart Things PT

## Resumo executivo

O projeto atual e um site estatico servido em GitHub Pages, com o catalogo alimentado por um `manifest` JSON gerado a partir de exportacoes do Telegram. O frontend esta concentrado quase todo em `index.html`, com HTML, CSS e JavaScript misturados no mesmo ficheiro. O pipeline de dados principal e funcional e nao deve ser quebrado:

1. Telegram export ou pasta de imagens
2. Scripts Python de extracao/importacao/sincronizacao
3. `imagens/telegram_manifest.json`
4. Site estatico em GitHub Pages

O foco da repaginacao deve ser o frontend e a camada de build estatico, preservando o `manifest` como fonte de verdade.

## Mapa do repositorio

### Frontend publico

- `index.html`
  - App monolitica atual.
  - Contem meta tags, CSS, tabs, grelha, modal, carrinho/pedido em `localStorage`, drawer/modal, renderizacao do catalogo e geracao da mensagem de WhatsApp.
- `site_config.js`
  - Hoje so expõe `enablePublicBuyLinks` e `buyRedirectBaseUrl`.
  - Precisa de passar a concentrar toda a configuracao publica do site.
- `imagens/telegram_manifest.json`
  - Fonte principal de dados do catalogo.
- `imagens/manifest.js`
  - Fallback inline para abrir o site localmente quando o `fetch` do manifest falha.

### Integracoes opcionais existentes

- `cloudflare_worker/buy_redirect_worker.js`
  - Redirect publico `?slug=...` para links externos guardados numa Google Sheet.
  - Protege o link final no HTML, mas nao serve para segredo absoluto.
- `google_apps_script/buy_redirect.gs`
  - Alternativa ao Worker com o mesmo objetivo.

### Pipeline de dados

- `telegram_extract.py`
  - Le exportacoes do Telegram (`result.json` ou `messages.html`).
  - Extrai nome, link, imagens e estrutura dados para gerar:
    - `captions.csv`
    - `google_sheets_buy_links.csv`
    - `imagens/telegram_manifest.json` quando usado com `--sync-site`
- `import_telegram_export.py`
  - Importador mais defensivo para casar mensagens com produtos existentes.
  - Atualiza manifest e copia imagens para o site.
  - Guarda provaveis para validacao manual.
- `sync_manifest.py`
  - Reconstroi/sincroniza `imagens/telegram_manifest.json` a partir das pastas de imagens.
  - Mantem slugs, nomes e imagens consistentes.
- `fix_slugs.py`
  - Sanitiza slugs/pastas e corrige referencias do manifest.
- `telegram_publish.py`
  - Usa o manifest para publicar no Telegram a partir de um CSV de precos/config.
  - Le `telegram_publish_config.json` e estado local em `_local/`.

## Estrutura atual dos dados do catalogo

### Origem principal

`imagens/telegram_manifest.json`

### Cobertura observada

- Total de produtos: `1276`
- Categorias:
  - `outros`: 477
  - `sneakers`: 455
  - `roupas`: 267
  - restantes categorias com menor volume: bolsas, tecnologia, fones, oculos, relogios, bones, chinelos
- Produtos com `brandSlug`: 521
- Produtos com `modelSlug`: 521
- Produtos com campo `price`: 39
- Maximo de imagens por produto observado: 16

### Campos recorrentes

- `slug`
- `name`
- `images[]`
- `latestTs`
- `category`
- `brandSlug`
- `brandLabel`
- `modelSlug`
- `modelLabel`
- `price` (nem sempre)
- `hasBuyLink` / `buyLink` em alguns fluxos

## Funcionamento atual do carrinho/pedido

O fluxo atual e um "carrinho" no browser, mas na pratica trata-se de um pedido por WhatsApp:

- Persistencia em `localStorage`
- Selecao obrigatoria de tamanho antes de adicionar
- Selecao de modelo/foto quando existe galeria
- Modal apos adicionar, com lista dos itens adicionados
- Geração de mensagem para WhatsApp com multiplos artigos

Pontos positivos atuais:

- Ja existe persistencia local
- Ja existe obrigatoriedade de tamanho/modelo
- Ja existe mensagem agregada para o WhatsApp

Limites atuais:

- A implementacao vive toda no `index.html`
- O formato da mensagem ainda nao esta normalizado como "codigo de pedido"
- Nao existe drawer lateral moderno e consistente entre catalogo e pagina de produto
- O estado dos filtros nao esta consolidado no URL de forma robusta

## Geração atual da mensagem de WhatsApp

O frontend atual constroi links `wa.me` / `api.whatsapp.com` no browser, combinando:

- numero de WhatsApp
- texto base
- lista de artigos do carrinho
- tamanho/modelo selecionados

Foi recentemente corrigido um bug em que o envio a partir do modal nao estava a incluir todos os artigos do carrinho.

## Integracoes Cloudflare Worker e Google Apps Script

As duas integracoes existentes resolvem o mesmo problema: esconder links de compra externos do HTML publico.

### Cloudflare Worker

- Le uma Google Sheet publica
- Procura pelo `slug`
- Faz redirect `302` para o `buyLink`

### Google Apps Script

- Faz a mesma pesquisa diretamente na Sheet
- Responde com redirect HTML/JS

### Conclusao

Estas integracoes sao opcionais para o objetivo atual. Como o site nao e uma loja online e o fluxo principal e WhatsApp, elas nao sao necessarias para a repaginacao principal. Podem continuar compatíveis, mas nao vao ser o centro da nova experiencia.

## Riscos e inconsistencias atuais

1. `index.html` demasiado grande e dificil de manter
2. Meta tags atuais apontam para `smartthingspt.com`, mas o site publico conhecido esta em `jamesstuartpt.github.io/SmartThings`
3. O viewport atual bloqueia zoom (`maximum-scale=1.0`, `user-scalable=no`)
4. Existem elementos de interface e claims que nao devem aparecer sem dados reais
5. `README.md` ainda nao existe
6. O frontend ainda mistura a semantica de "compra" com "pedido"
7. O build atual nao gera paginas estaticas por produto
8. O pipeline nao expõe videos por produto no manifest; so imagens

## Decisao tecnica para a nova fase

A repaginacao deve:

- manter `imagens/telegram_manifest.json` como fonte de verdade
- criar uma camada de build estatico em Node, sem dependencias pesadas
- separar CSS e JS em modulos
- gerar paginas de produto estaticas por `slug`
- gerar ficheiros auxiliares (`sitemap.xml`, `robots.txt`, `404.html`, chunks JSON)
- preservar compatibilidade com os scripts Python existentes

## Compatibilidade com o pipeline

O pipeline Telegram -> manifest -> site continua viavel se:

1. `telegram_extract.py`, `import_telegram_export.py`, `sync_manifest.py` continuarem a escrever no mesmo `imagens/telegram_manifest.json`
2. a nova camada de build consumir esse manifest sem alterar o seu contrato base
3. a documentacao indicar claramente quando correr o build apos atualizar o manifest

Esse sera o modelo adotado.
