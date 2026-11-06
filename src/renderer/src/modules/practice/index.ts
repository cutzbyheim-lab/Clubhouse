import { Target } from 'lucide-react';
import { defineModule } from '@/app/module';

export default defineModule({
  id: 'practice',
  path: 'practice',
  title: 'Practice center',
  group: 'Improve',
  icon: Target,
  lede: 'Plan sessions around your weak spots and log what you actually practised.',
  load: () => import('@/app/ModulePending'),
});
