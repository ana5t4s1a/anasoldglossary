/** @type {import('tailwindcss').Config} */
module.exports = {
    content: ['./index.html', './app.js'],
    darkMode: 'class',
    theme: {
        extend: {
            // Colors point to CSS variables (defined in style.css) so dark mode only swaps the variables
            colors: {
                cocoa: {
                    DEFAULT: 'var(--cocoa)',
                    dark: 'var(--cocoa-dark)',
                    soft: 'var(--cocoa-soft)'
                },
                surface: 'var(--surface)',
                'cream-card': 'var(--cream-card)',
                'cream-tint': 'var(--cream-tint)',
                line: 'var(--line)',
                'mint-dark': 'var(--mint-dark)',
                'mint-pastel': 'var(--mint-pastel)',
                'pink-pastel': 'var(--pink-pastel)',
                'amber-text': 'var(--amber-text)',
                danger: 'var(--danger)'
            }
        }
    },
    plugins: []
};
