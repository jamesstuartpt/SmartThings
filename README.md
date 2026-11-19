# Smart Things PT

Catálogo estático em pt-PT para GitHub Pages. O cliente escolhe artigos e tamanhos, organiza tudo num pedido e envia esse pedido para o WhatsApp. O stock, o preço final, o envio e o pagamento são confirmados depois no WhatsApp.

## Stack

- Site estático gerado por `node ./scripts/build-site.mjs`
- Fonte de verdade do catálogo: `imagens/telegram_manifest.json`
- Frontend modular em `css/` e `js/`
- Deploy em GitHub Pages via GitHub Actions

## Estrutura importante

- `site_config.js`: configuração pública do site
- `imagens/telegram_manifest.json`: catálogo vindo do pipeline do Telegram
- `data/estado.json`: disponibilidade e estados editáveis sem mexer no código
- `scripts/build-site.mjs`: gera páginas estáticas, sitemap, robots e JSON do catálogo
- `scripts/check-site.mjs`: valida slugs, imagens, links vazios e botões mortos
- `scripts/optimize_images.py`: gera versões `.webp` ao lado das imagens existentes

## Como atualizar o catálogo

1. Atualizar o conteúdo vindo do Telegram:
   - `telegram_extract.py`
   - `import_telegram_export.py`
   - `sync_manifest.py`
   - `fix_slugs.py`
2. Confirmar que `imagens/telegram_manifest.json` ficou correto.
3. Opcional: gerar WebP com `python .\\scripts\\optimize_images.py`
4. Construir o site:

```bash
npm run build
```

5. Validar antes de publicar:

```bash
npm run check
```

Para desenvolvimento local:

```bash
npm run dev
```

Depois abrir `http://127.0.0.1:8000/SmartThings/`.

## Como marcar artigos esgotados

Editar `data/estado.json`.

Exemplo:

```json
{
  "items": {
    "adidas_adizero_exemplo": {
      "status": "esgotado"
    },
    "produto_so_consulta": {
      "priceType": "consult",
      "priceLabel": "Sob consulta"
    }
  }
}
```

Campos suportados hoje:

- `status`: `disponivel` ou `esgotado`
- `priceType`: `fixed` ou `consult`
- `priceLabel`: rótulo de preço customizado

## Configuração do site

Tudo o que é público fica em `site_config.js`.

Campos principais:

- `baseUrl`: URL pública do site
- `support.whatsappNumber`: número usado no botão e no envio do pedido
- `support.telegramUrl`: link do canal Telegram
- `seller.*`: textos de vendedor, prazo, pagamento e devoluções
- `catalog.*`: hero, preço base e avisos de pedido
- `analytics.enabled`: desligado por defeito

## Domínio próprio

Enquanto o domínio próprio não estiver confirmado, o canonical e as meta tags usam:

- `https://jamesstuartpt.github.io/SmartThings`

Quando houver domínio próprio:

1. Atualizar `site_config.js > baseUrl`
2. Adicionar `CNAME` ao deploy do GitHub Pages
3. Voltar a correr `npm run build`

## WhatsApp e Telegram

- Os links públicos não devem ficar vazios
- O botão de pedido gera sempre um código curto `ST-AAMMDD-XXXX`
- O botão "Copiar pedido" serve de fallback quando o WhatsApp não abre

## Build e deploy

O workflow em `.github/workflows/pages.yml` faz:

1. checkout
2. `npm run build`
3. `npm run check`
4. deploy para GitHub Pages

## Pendentes do dono

- Confirmar texto final de trocas e devoluções
- Confirmar NIF
- Confirmar domínio próprio
- Confirmar se quer analytics sem cookies e qual fornecedor
