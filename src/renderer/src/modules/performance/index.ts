import { Activity } from 'lucide-react';
import { defineModule } from '@/app/module';

export default defineModule({
  id: 'performance',
  path: 'performance',
  title: 'Performance lab',
  group: 'Analyse',
  icon: Activity,
  lede: 'Trends across rounds and sessions, measured against your own baseline.',
  load: () => import('./PerformancePage'),
});
