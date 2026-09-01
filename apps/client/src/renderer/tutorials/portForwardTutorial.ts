import hospedarPt from '../assets/tutorials/hospedar.pt.png';
import hospedarEn from '../assets/tutorials/hospedar.en.png';
import type { TutorialDefinition } from './TutorialDefinition';

export const portForwardTutorial: TutorialDefinition = {
  id: 'port-forward',
  name: 'tutorial.portForward.name',
  icon: 'router',
  steps: [
    {
      title: 'tutorial.portForward.step1.title',
      content: 'tutorial.portForward.step1.content',
      tip: 'tutorial.portForward.step1.tip',
    },
    {
      title: 'tutorial.portForward.step2.title',
      content: 'tutorial.portForward.step2.content',
    },
    {
      title: 'tutorial.portForward.step3.title',
      content: 'tutorial.portForward.step3.content',
      tip: 'tutorial.portForward.step3.tip',
    },
    {
      title: 'tutorial.portForward.step4.title',
      content: 'tutorial.portForward.step4.content',
    },
    {
      title: 'tutorial.portForward.step5.title',
      content: 'tutorial.portForward.step5.content',
      image: { 'pt-BR': hospedarPt, en: hospedarEn },
      tip: 'tutorial.portForward.step5.tip',
    },
    // Abrir porta não resolve atrás de CGNAT, e o relay já existe desde a #428.
    // Sem este passo o tutorial manda tentar e não diz o que fazer quando falha.
    {
      title: 'tutorial.portForward.step6.title',
      content: 'tutorial.portForward.step6.content',
      tip: 'tutorial.portForward.step6.tip',
    },
  ],
};
