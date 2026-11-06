import { Crosshair } from 'lucide-react';
import { defineModule } from '@/app/module';

export default defineModule({
  id: 'shots',
  path: 'shots',
  title: 'Shot analytics',
  group: 'Analyse',
  icon: Crosshair,
  lede: 'Carry, dispersion and launch by club, from the shots you have logged.',
  load: () => import('./ShotsPage'),
});
