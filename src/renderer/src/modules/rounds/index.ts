import { ClipboardList } from 'lucide-react';
import { defineModule } from '@/app/module';

export default defineModule({
  id: 'rounds',
  path: 'rounds',
  title: 'Round tracker',
  group: 'Play',
  icon: ClipboardList,
  lede: 'Score rounds hole by hole: strokes, putts, fairways, greens and penalties.',
  load: () => import('@/app/ModulePending'),
});
