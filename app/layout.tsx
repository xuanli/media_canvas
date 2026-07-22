import './globals.css'
export const metadata = { title: 'Media Canvas' }

// Applies the persisted theme before first paint (no dark→light flash).
// Must stay in sync with components/ThemeToggle.tsx's 'gm-theme' key and
// the data-gm-theme palettes in globals.css; dark is the default so only
// 'light' needs stamping. suppressHydrationWarning on <html>: the attribute
// is intentionally client-set before React hydrates.
const themeInit = `try{if(localStorage.getItem('gm-theme')==='light')document.documentElement.dataset.gmTheme='light'}catch(e){}`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
