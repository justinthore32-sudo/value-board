/* Petits helpers d'interface partagés : toasts (remplacent les alert() natifs)
   et état de chargement pendant db.sync(). */

function showToast(message, type = "info") {
  const colors = {
    info: { bg: "#eaf1fb", border: "#cddffb", text: "#1c4a80" },
    success: { bg: "#e9f8e9", border: "#bfe8bf", text: "#1d5e1d" },
    error: { bg: "#fbe9e9", border: "#f0bcbc", text: "#8a1f1f" },
  };
  const c = colors[type] || colors.info;

  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.style.cssText = "position:fixed; top:16px; right:16px; z-index:1000; display:flex; flex-direction:column; gap:8px;";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.textContent = message;
  toast.style.cssText = `background:${c.bg}; border:1px solid ${c.border}; color:${c.text}; padding:12px 16px; border-radius:8px; font-size:14px; box-shadow:0 2px 8px rgba(0,0,0,0.08); max-width:340px;`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.transition = "opacity 0.3s";
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function showLoading() {
  const layout = document.getElementById("layout");
  const loading = document.createElement("div");
  loading.id = "loading-state";
  loading.style.cssText = "padding:40px; color:#5a5850; font-size:14px;";
  loading.textContent = "Chargement…";
  layout.appendChild(loading);
}

function hideLoading() {
  const loading = document.getElementById("loading-state");
  if (loading) loading.remove();
}
