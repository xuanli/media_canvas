import './globals.css'
export const metadata = { title: 'gen_media' }
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>
}
