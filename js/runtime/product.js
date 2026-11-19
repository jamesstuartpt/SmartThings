import { $, $all, readJsonScript } from "./helpers.js";
import { OrderStore } from "./order.js";

export function initProductPage(orderStore) {
  const data = readJsonScript("st-product-data");
  if (!data?.product) {
    return;
  }
  const product = data.product;
  const addButton = $("#product-add");
  const sizeButtons = $all("[data-product-size]");
  const mainImage = $("#product-main-image");
  const thumbButtons = $all("[data-gallery-thumb]");
  const zoomBackdrop = $("#zoom-backdrop");
  const zoomModal = $("#zoom-modal");
  const zoomImage = $("#zoom-image");
  const guideBackdrop = $("#size-guide-backdrop");
  const guideModal = $("#size-guide-modal");
  let activeSize = product.sizes?.[0] || "";

  function setActiveImage(src, alt) {
    if (mainImage) {
      mainImage.src = src;
      mainImage.alt = alt;
    }
    if (zoomImage) {
      zoomImage.src = src;
      zoomImage.alt = alt;
    }
    thumbButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.image === src);
    });
  }

  sizeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      activeSize = button.dataset.productSize || "";
      sizeButtons.forEach((node) => node.classList.remove("is-active"));
      button.classList.add("is-active");
    });
  });

  thumbButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setActiveImage(button.dataset.image, button.dataset.alt || product.name);
    });
  });

  $("#product-open-zoom")?.addEventListener("click", () => {
    if (zoomModal && zoomBackdrop) {
      zoomModal.hidden = false;
      zoomBackdrop.hidden = false;
      zoomModal.classList.add("is-open");
      zoomBackdrop.classList.add("is-open");
      document.body.classList.add("no-scroll");
    }
  });

  $all("[data-close-zoom]").forEach((button) =>
    button.addEventListener("click", () => {
      zoomModal?.classList.remove("is-open");
      zoomBackdrop?.classList.remove("is-open");
      document.body.classList.remove("no-scroll");
      window.setTimeout(() => {
        if (zoomModal) {
          zoomModal.hidden = true;
        }
        if (zoomBackdrop) {
          zoomBackdrop.hidden = true;
        }
      }, 180);
    })
  );

  $("#size-guide-open")?.addEventListener("click", () => {
    if (guideModal && guideBackdrop) {
      guideModal.hidden = false;
      guideBackdrop.hidden = false;
      guideModal.classList.add("is-open");
      guideBackdrop.classList.add("is-open");
      document.body.classList.add("no-scroll");
    }
  });

  $all("[data-close-guide]").forEach((button) =>
    button.addEventListener("click", () => {
      guideModal?.classList.remove("is-open");
      guideBackdrop?.classList.remove("is-open");
      document.body.classList.remove("no-scroll");
      window.setTimeout(() => {
        if (guideModal) {
          guideModal.hidden = true;
        }
        if (guideBackdrop) {
          guideBackdrop.hidden = true;
        }
      }, 180);
    })
  );

  addButton?.addEventListener("click", () => {
    orderStore.add({
      slug: product.slug,
      name: product.name,
      brandLabel: product.brandLabel,
      size: activeSize,
      sizeOptions: product.sizes,
      quantity: 1,
      priceLabel: product.priceLabel,
      priceValue: product.priceValue,
      priceType: product.priceType,
      image: product.coverImage,
      url: product.absoluteUrl
    });
  });
}

export function initProductApp() {
  const orderStore = new OrderStore();
  initProductPage(orderStore);
}
