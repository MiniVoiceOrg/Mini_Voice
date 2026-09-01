import type { TutorialDefinition } from './TutorialDefinition';

/**
 * Guia de quem foi convidado.
 *
 * O assistente cobria só quem hospeda: clicar em "Entrar num servidor"
 * fechava tudo e trocava de aba, sem uma linha de orientação — justamente
 * para o usuário mais comum, que é o amigo convidado (#496).
 */
export const joinTutorial: TutorialDefinition = {
  id: 'join-server',
  name: 'tutorial.join.name',
  icon: 'login',
  steps: [
    {
      title: 'tutorial.join.step1.title',
      content: 'tutorial.join.step1.content',
      tip: 'tutorial.join.step1.tip',
    },
    {
      title: 'tutorial.join.step2.title',
      content: 'tutorial.join.step2.content',
      tip: 'tutorial.join.step2.tip',
    },
    {
      title: 'tutorial.join.step3.title',
      content: 'tutorial.join.step3.content',
    },
    {
      title: 'tutorial.join.step4.title',
      content: 'tutorial.join.step4.content',
      tip: 'tutorial.join.step4.tip',
    },
    {
      title: 'tutorial.join.step5.title',
      content: 'tutorial.join.step5.content',
    },
  ],
};
