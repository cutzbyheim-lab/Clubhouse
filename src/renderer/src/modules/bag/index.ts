import { Briefcase } from 'lucide-react';
import { defineModule } from '@/app/module';

export default defineModule({
  id: 'bag',
  path: 'bag',
  title: 'Golf bag',
  group: 'Gear',
  icon: Briefcase,
  lede: 'The fourteen clubs you carry, with lofts and your own distances for each.',
  load: () => import('./BagPage'),
});
