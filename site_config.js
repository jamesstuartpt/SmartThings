window.SMARTTHINGS_CONFIG = Object.assign(
  {
    // `false`: o site publico nunca mostra nem usa o link de compra final.
    enablePublicBuyLinks: false,
    // Cola aqui a URL publica do teu redirect service.
    // Exemplo recomendado:
    // buyRedirectBaseUrl: "https://smartthings-buy-redirect.<subdominio>.workers.dev",
    buyRedirectBaseUrl:
      "https://smartthings-buy-redirect.jamesstuarttpt.workers.dev/",
  },
  window.SMARTTHINGS_CONFIG || {},
);
