const SMARTTHINGS_CONFIG = {
  siteName: "Smart Things PT",
  language: "pt-PT",
  currency: "EUR",
  locale: "pt_PT",
  baseUrl: "https://jamesstuartpt.github.io/SmartThings",
  customDomain: "",
  defaultOgImage: "imagens/og-default.svg",
  support: {
    whatsappNumber: "351927515217",
    whatsappLabel: "+351 927 515 217",
    whatsappBaseMessage:
      "Olá! Vi o catálogo da Smart Things PT e quero confirmar stock, preço final e envio.",
    telegramUrl: "https://t.me/smartthingspt",
    telegramLabel: "@smartthingspt"
  },
  seller: {
    displayName: "Smart Things PT",
    legalName: "",
    taxId: "",
    taxIdTodo: "TODO: confirmar NIF do vendedor",
    returnsPolicyTitle: "Trocas e devoluções",
    returnsPolicyBody:
      "TODO: confirmar com o dono a política final de trocas e devoluções antes de publicar a versão final.",
    shippingPolicy:
      "Envio normalmente confirmado no WhatsApp. Prazo médio previsto: 10 a 15 dias.",
    paymentPolicy:
      "Pagamento por MB Way após confirmação do pedido no WhatsApp."
  },
  catalog: {
    fixedPriceLabel: "40€",
    fixedPriceValue: 40,
    consultPriceLabel: "Sob consulta",
    shippingNotice:
      "Preço final e custo de envio confirmados no WhatsApp antes de fechar o pedido.",
    heroTitle: "Catálogo streetwear e sneakers, sem complicar o pedido.",
    heroIntro:
      "Escolhe os artigos, define os tamanhos e envia tudo num pedido organizado pelo WhatsApp.",
    heroCtaLabel: "Ver catálogo",
    orderCtaLabel: "Abrir pedido",
    steps: [
      "Escolher os artigos",
      "Adicionar ao pedido",
      "Enviar no WhatsApp"
    ]
  },
  ui: {
    accentColor: "#c7ff3d",
    defaultTheme: "system",
    showSocialProof: false,
    themeToggleLabel: "Alternar tema",
    reducedMotionRespect: true
  },
  order: {
    storageKey: "smartthings_order_v3",
    customerNameKey: "smartthings_customer_name_v1",
    textBase:
      "Preço final e envio confirmados no WhatsApp. Obrigado.",
    codePrefix: "ST"
  },
  analytics: {
    enabled: false,
    provider: "",
    plausibleDomain: ""
  },
  seo: {
    title: "Smart Things PT | Catálogo de sneakers, roupa e acessórios",
    description:
      "Catálogo estático com pedido por WhatsApp. Escolhe artigos e tamanhos, envia o pedido e confirma stock, preço final e envio no WhatsApp.",
    twitterHandle: "@smartthingspt"
  },
  optionalRedirect: {
    enablePublicBuyLinks: false,
    buyRedirectBaseUrl:
      "https://smartthings-buy-redirect.jamesstuarttpt.workers.dev/"
  }
};

const runtimeConfig =
  typeof window !== "undefined"
    ? Object.assign({}, SMARTTHINGS_CONFIG, window.SMARTTHINGS_CONFIG || {})
    : SMARTTHINGS_CONFIG;

if (typeof window !== "undefined") {
  window.SMARTTHINGS_CONFIG = runtimeConfig;
}

export default runtimeConfig;
