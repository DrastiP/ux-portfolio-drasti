(function() {
    const savedTheme = localStorage.getItem('theme');
    // Default to dark if no theme is saved, or if saved theme is 'dark'
    if (savedTheme !== 'light') {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
})();

document.addEventListener('DOMContentLoaded', () => {
    const themeToggle = document.getElementById('theme-toggle');
    if (!themeToggle) return;

    themeToggle.addEventListener('click', () => {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        if (isDark) {
            document.documentElement.removeAttribute('data-theme');
            localStorage.setItem('theme', 'light');
        } else {
            document.documentElement.setAttribute('data-theme', 'dark');
            localStorage.setItem('theme', 'dark');
        }
    });
});
