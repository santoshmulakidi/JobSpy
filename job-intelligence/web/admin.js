const root = document.documentElement;
const buttons = document.querySelectorAll("[data-theme-button]");
const savedTheme = localStorage.getItem("admin-theme");

function applyTheme(theme) {
  root.dataset.theme = theme;
  localStorage.setItem("admin-theme", theme);
  buttons.forEach((button) => {
    button.classList.toggle("active", button.dataset.themeButton === theme);
  });
}

buttons.forEach((button) => {
  button.addEventListener("click", () => applyTheme(button.dataset.themeButton));
});

if (savedTheme) {
  applyTheme(savedTheme);
}
