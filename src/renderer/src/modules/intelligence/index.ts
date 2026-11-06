import { Lightbulb } from 'lucide-react';
import { defineModule } from '@/app/module';

export default defineModule({
  id: 'intelligence',
  path: 'intelligence',
  title: 'Intelligence',
  group: 'Analyse',
  icon: Lightbulb,
  lede: 'Findings from your data, each shown with the evidence and sample size behind it.',
  load: () => import('./IntelligencePage'),
});
