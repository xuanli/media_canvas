import { CanvasApp } from '@/components/CanvasApp'
import { EXAMPLE_CANVAS } from '@/lib/example-canvas'
import { ExampleForkGuard } from '@/app/c/[id]/ExampleForkGuard'

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // Master-canvas protection: opening the example's own id forks a copy and
  // redirects (ExampleForkGuard) so the master is never directly editable.
  if (id === EXAMPLE_CANVAS.id) return <ExampleForkGuard />
  return <CanvasApp canvasId={id} />
}
