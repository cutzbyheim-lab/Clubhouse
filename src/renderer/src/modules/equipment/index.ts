import { Wrench } from 'lucide-react';
import { defineModule } from '@/app/module';

export default defineModule({
  id: 'equipment',
  path: 'equipment',
  title: 'Equipment lab',
  group: 'Gear',
  icon: Wrench,
  lede: 'Specs, shafts and gapping across everything you own, in the bag or not.',
  load: () => import('./EquipmentPage'),
});
