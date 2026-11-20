# Decisoes de implementacao

## D001 - Fonte de verdade do catalogo

Decisao:
Manter `imagens/telegram_manifest.json` como fonte principal do catalogo.

Motivo:
Ja existe um pipeline funcional de importacao e sincronizacao a partir do Telegram. Trocar a estrutura agora aumentaria o risco de quebrar o fluxo operacional.

Impacto:
O novo frontend e o build estatico vao consumir o manifest e gerar derivados, sem alterar o contrato principal usado pelos scripts Python.

## D002 - Build estatico simples em Node

Decisao:
Usar um script de build em Node, sem frameworks nem dependencias pesadas.

Motivo:
Precisamos de gerar paginas estaticas por produto, chunks JSON, sitemap e ficheiros auxiliares, mantendo o deploy facil em GitHub Pages.

Impacto:
O site continua estatico. O build passa a ser um passo explicito apos atualizar o manifest.

## D003 - Pedido por WhatsApp em vez de checkout

Decisao:
Toda a linguagem principal do frontend passa a usar "Pedido" em vez de "Compra" quando se refere ao fluxo do cliente.

Motivo:
O site nao fecha pagamento nem confirma stock; isso acontece no WhatsApp.

Impacto:
CTA, drawer, mensagens e paginas informativas vao refletir essa semantica.

## D004 - Links de compra externos ficam opcionais e desligados por defeito

Decisao:
Nao centrar a nova experiencia nos redirects externos do Worker/GAS.

Motivo:
O fluxo principal pedido pelo dono e catalogo -> pedido -> WhatsApp.

Impacto:
As integracoes atuais ficam documentadas e compatíveis, mas o frontend nao depende delas para o caso principal.

## D005 - Estado de disponibilidade simples em ficheiro editavel

Decisao:
Criar `data/estado.json` para controlar disponibilidade e badges como `esgotado`.

Motivo:
Permite editar disponibilidade sem tocar no codigo nem no manifest base.

Impacto:
O build vai fundir o estado do manifest com esse ficheiro.

## D006 - Analytics desligado por defeito

Decisao:
Qualquer analytics fica opt-in via configuracao.

Motivo:
O requisito pede algo sem cookies e configuravel, desligado por defeito.

Impacto:
Sem dados reais/configurados, o site nao injeta tracking.

## D007 - Videos reais do Telegram

Decisao:
Nao inventar suporte total a videos por produto sem dados no pipeline.

Motivo:
O manifest atual guarda imagens, nao uma estrutura consistente de videos por produto.

Impacto:
O frontend mostrara fotos reais do produto e um CTA para o Telegram quando o dono quiser reforcar a prova visual. Suporte a video por produto fica como extensao futura do pipeline.

## D008 - Dominio canonico

Decisao:
Usar o dominio real servido pela configuracao publica. Na ausencia de dominio proprio confirmado, usar GitHub Pages.

Motivo:
As meta tags atuais apontam para um dominio diferente do site que esta efetivamente online.

Impacto:
`site_config.js` passa a ser a referencia do URL base do site e a documentacao explica como trocar para dominio proprio com `CNAME`.

## D009 - Imagens

Decisao:
Implementar agora `lazy-loading`, dimensoes, placeholders e estrutura para otimizacao; deixar a conversao massiva para WebP automatizada por script local, sem a tornar bloqueante para o rebuild inicial.

Motivo:
Converter todo o acervo imediatamente aumenta bastante o tempo e o risco operacional desta repaginacao.

Impacto:
O site melhora ja na renderizacao e no carregamento. O script de otimizacao fica preparado para a fase operacional seguinte.

## D010 - Escolha simples quando faltarem dados do dono

Decisao:
Quando faltarem NIF, texto final de devolucoes, dominio proprio ou seller legal, o frontend mostra apenas o que esta configurado e deixa `TODO` documentado.

Motivo:
O pedido foi para nao parar o trabalho por duvidas e registar em documentacao.

Impacto:
O site nao inventa informacao legal/comercial que o dono ainda nao confirmou.

## D011 - Links privados fora do manifest publico

Decisao:
Os `buyLink` deixam de viver no `imagens/telegram_manifest.json` e passam para uma folha privada/CSV privado de admin.

Motivo:
O repositorio e o frontend sao publicos. Mesmo que o link nao apareca na interface, manter o `buyLink` no manifest publicado expoe esse dado.

Impacto:
O importador passa a gerar `_local/private_admin/links_sheet_import.csv` para importar numa Google Sheet privada e remove os links do manifest antes de gravar.

## D012 - Apps Script privado configurado, mas sem envio inseguro no frontend

Decisao:
Registar o URL real do Google Apps Script na configuracao e documentacao, mantendo desligado o envio automatico a partir do frontend publico.

Motivo:
O endpoint atual depende de token. Colocar esse segredo no browser quebraria o requisito de nao expor chaves no frontend.

Impacto:
O projeto fica alinhado com a sheet e o Apps Script reais, mas a integracao automatica so deve ser ativada com uma ponte segura server-side ou outro mecanismo sem segredo no cliente.
