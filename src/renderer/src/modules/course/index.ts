import { Mountain } from 'lucide-react';
import { defineModule } from '@/app/module';

export default defineModule({
  id: 'course',
  path: 'course',
  title: 'Course visualizer',
  group: 'Play',
  icon: Mountain,
  lede: 'Walk each hole in 3D with your recorded shots laid over the terrain.',
  load: () => import('./CoursePage'),
});
