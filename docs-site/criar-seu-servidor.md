# Criar Seu Servidor

Na aba **Meus Servidores › Criar Servidor**, preencha nickname do anfitrião, nome do servidor, porta local, senha opcional e os canais iniciais de texto e voz.

Clique em **Criar e Iniciar Servidor**. O servidor sobe na sua máquina, escuta em todas as interfaces de rede na porta escolhida e você entra automaticamente.

Servidores criados ficam salvos (até 10). Depois, use **Iniciar**, **Parar** ou **X** na aba *Meus Servidores*.

## Convidar amigos

Dentro do servidor, clique no **nome do servidor** › **Convidar Amigos**. O app mostra nome, IP público e porta, e copia o convite.

| Situação | IP que seus amigos devem usar |
|---|---|
| Mesma rede local | Seu IP local, ou a descoberta automática do app |
| Outra internet | Seu IP público + porta liberada no roteador |
| Sem mexer no roteador | IP da VPN, como Radmin VPN, Hamachi, ZeroTier ou Tailscale |

## Liberar acesso pela internet

Libere a porta no firewall, faça port forwarding da porta `3000` (ou a escolhida) para o IP local do PC e use VPN se o provedor estiver atrás de CGNAT.

## Administrar

Em **Configurações do Servidor** é possível renomear o servidor, alterar/remover senha e permitir ou bloquear o soundboard. Os cabeçalhos de canais têm **+** para criar e lixeira para apagar.
