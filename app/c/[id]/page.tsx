import { CanvasApp } from '@/components/CanvasApp'

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <CanvasApp canvasId={id} />
}
