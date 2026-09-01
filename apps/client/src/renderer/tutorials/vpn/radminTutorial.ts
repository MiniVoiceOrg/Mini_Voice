import hospedarPt from '../../assets/tutorials/hospedar.pt.png';
import hospedarEn from '../../assets/tutorials/hospedar.en.png';
import type { TutorialDefinition } from '../TutorialDefinition';

export const radminTutorial: TutorialDefinition = {
  id: 'radmin-vpn',
  name: 'tutorial.radmin.name',
  icon: 'vpn_lock',
  steps: [
    {
      title: 'tutorial.radmin.step1.title',
      content: 'tutorial.radmin.step1.content',
    },
    {
      title: 'tutorial.radmin.step2.title',
      content: 'tutorial.radmin.step2.content',
    },
    {
      title: 'tutorial.radmin.step3.title',
      content: 'tutorial.radmin.step3.content',
      tip: 'tutorial.radmin.step3.tip',
    },
    {
      title: 'tutorial.radmin.step4.title',
      content: 'tutorial.radmin.step4.content',
    },
    {
      title: 'tutorial.radmin.step5.title',
      content: 'tutorial.radmin.step5.content',
      image: { 'pt-BR': hospedarPt, en: hospedarEn },
      tip: 'tutorial.radmin.step5.tip',
    },
  ],
};
