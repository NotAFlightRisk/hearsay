// before first paint, so a picked theme never flashes the other one
try {
  const { theme } = JSON.parse(localStorage.getItem('hearsay:settings') ?? '{}');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
} catch {
  // nothing saved we can read
}
