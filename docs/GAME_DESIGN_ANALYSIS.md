# Análise de game design — Pedra, Papel e Tesoura

## Fantasia e ciclo atual

O jogador desafia um adversário que comenta e aprende tendências. Cada combate usa vida e dano para transformar sucessivas mãos de R/P/T em uma vitória de ponto; os combates acumulam placar até 10. Poderes podem curar ou alterar a próxima mão. Vitórias podem gerar Luck Blocks e itens do perdedor passam ao vencedor.

**Ciclo observado:** entrar → escolher em até 5 s → revelar as mãos e aplicar dano → decidir se usa poder → vencer o combate → receber/transferir itens → continuar até 10 pontos ou perder por falta.

## Mecânicas e avaliação

| Sistema | Comportamento implementado | Leitura de design | Avaliação |
|---|---|---|---|
| Pedra, papel e tesoura | Relação clássica, empate sem dano. | Fácil de aprender e de ler; estratégia fica em antecipar o oponente e escolher timing de poder. | Essencial e boa base competitiva. |
| Combate de PV | 100 PV cada, 20 dano padrão, 30 crítico; combate concede ponto ao zerar PV. | Transformar cada combate em uma série de mãos dá peso à partida, mas não altera a probabilidade do RPS básico. | Essencial; medir duração real. |
| Timer e faltas | 5 s; duas faltas geram mão aleatória; terceira encerra a partida por inatividade. Faltas persistem entre combates. | Cria urgência, mas a consequência da terceira falta é muito maior que uma mão perdida e não mede habilidade de RPS. | Potencialmente prejudicial se houver abandono ou frustração observável. |
| Cura | Sorteia 10–50 PV e aplica até o limite; ação imediata, consome um item, não consome mão. | Boa recuperação e escolha de timing, mas tende a ser uso óbvio quando existe déficit de vida; perto de 100 há desperdício. | Opcionável; manter regra até medir taxa de uso e impacto. |
| Defesa | Reduz o próximo golpe recebido pela metade (ceil); expira após uma mão mesmo se empate ou o jogador não for atingido. | Pode virar leitura estratégica se o rival puder responder; sem custo claro além do consumível e do relógio. | Opcionável; comunicar o risco de expirar sem mitigar dano. |
| Crítico | Aumenta golpe próprio de 20 para 30; se perder/empatar, item desaparece sem dano crítico. | Cria decisão de timing, porém pode ser confundido com garantia de dano se a mão não favorece. | Opcionável; explicitar a condição de acerto antes de ativar. |
| Luck Blocks | Prêmio aleatório cura/defesa/crítico a cada 3 pontos de cada lado, até 9 pontos. | Recompensa frequente dá marco de progresso, mas não oferece escolha e pode dar recurso de valor muito diferente conforme estado. | Opcional; avaliar seleção entre dois itens como alternativa, somente após balanceamento. |
| Transferência | Ao vencer combate, vencedor recebe todo inventário do adversário. | Faz itens circularem e reforça consequência de duelo; também pode ampliar liderança e oscilar muito quando há muitos itens. | Risco potencial de snowball; comparar em playtest, sem presumir alteração. |
| IA | Primeiras três mãos aleatórias; depois usa frequência, transições e repetição do histórico com 25% aleatório. | Pode recompensar adaptação mútua e punir repetição. Não conhece a mão atual, mas a regra não é apresentada como nível configurável. | Boa oportunidade para dificuldade e personalidade; tornar a política compreensível. |

## Aleatoriedade e balanço matemático

- Cura é sorteio inteiro uniforme entre 10 e 50 (41 valores), média do sorteio bruto de 30 PV; a cura efetiva é limitada ao espaço até 100. Exemplo: a 90 PV, o ganho efetivo fica entre 10 e 10; o excedente é perdido.
- Defesa transforma 20 em 10 e 30 em 15; economia de vida máxima por uso é 10 ou 15 PV se a mão for atingida.
- Crítico acrescenta 10 de dano quando o jogador vence. São necessários cinco golpes padrão para retirar 100 PV, ou quatro golpes críticos se todos conectarem e o adversário não curar/defender.
- Se o jogador repetir pedra, a política tende a escolher papel como resposta. Sob premissas simplificadas de histórico estável, contrarresposta top em 79% dos casos condicionais e 25% de aleatoriedade global: aproxima-se de 67,6% de papel e 24,1% de tesoura, antes de empates/ordem secundária. É aproximação derivada da política, não medição de taxa de vitória.
- Em cenário simétrico sem poderes, uma partida até 10 pontos pode levar perto de 186 escolhas (~15,5 min no pior caso de cada escolha consumir os 5 s), incluindo empates e combates. É cálculo ilustrativo; a IA adaptativa e poderes invalidam a premissa de simetria. Medir duração real antes de mexer na meta.

## Justiça, controle e recuperação

O jogador escolhe a mão e decide o momento dos poderes, então há controle tático real. A IA usa história observada, e fala sobre adaptação, mas o jogador não escolhe dificuldade nem vê a regra matemática. Há recuperação possível porque inventários mudam de dono e combates restauram vida; por outro lado, o derrotado entrega todos os itens e ainda pode enfrentar 10 pontos totais de partida. Medir percepção de justiça por placar, inventário, faltas e repetição de padrão.

No estado atual, a cura tem custo em item, mas não em turno; portanto, quando há cura e PV abaixo de 100, o uso é em geral uma escolha dominante, salvo desperdício ou preferir guardar o item para futuro. Defesa/crítico têm custo de oportunidade do próximo turno e risco de expirar. O relógio mantém pressão mesmo enquanto o jogador lê ou usa habilidade.

## Essencial, opcional e potencialmente prejudicial

- **Essencial para MVP competitivo:** R/P/T determinístico, turno válido e explícito, resultado reproduzível, tempo/faltas coerentes, resultado e revanche claros.
- **Opcionais após validar o núcleo:** IA com níveis, poderes, Luck Blocks, estatísticas pessoais e cosméticos. Esses sistemas devem ampliar escolhas sem tornar o resultado dependente de vantagem adquirida.
- **Potencialmente prejudiciais se persistirem sem ajuste:** derrota por três faltas em qualquer ponto; IA adaptativa sem explicação/nível; cura repetível sem consumir mão; perda total de inventário; prêmio aleatório cuja utilidade depende muito do estado.

## Retenção e recompensas

Há progressão de curto prazo: até 10 pontos, itens a cada 3 vitórias próprias e transferência entre oponentes. Não encontrei perfil, XP persistente, estatísticas ou desbloqueios entre sessões. A sugestão futura é testar primeiro estatísticas pessoais e cosméticos de mérito. Se XP for aprovado, perdas podem render progresso de participação pequeno e limitado; vitória pode oferecer bônus. Não recompensar ficar sem escolher, partidas prolongadas artificialmente ou sequência diária obrigatória.

Um ciclo futuro saudável seria: **entrar → escolher modo/dificuldade → jogar → receber resultado e estatísticas → ganhar progresso cosmético proporcional → optar por revanche, treino ou sair**. Métricas: conclusão, replay voluntário, duração, faltas, taxa de uso de poder quando disponível, justiça percebida e diversão declarada.

## Experimentos propostos (sem implementar)

1. Comparar IA aleatória e adaptativa em dificuldade declarada, com adversários de repetição baixa/média/alta. Métrica: justiça percebida e conclusão, junto de vitórias por estilo.
2. Testar 5 s versus tempo casual maior/sem timer em grupos separados. Métrica: faltas, duração e preferência declarada.
3. Comparar transferência integral com limite/transferência parcial apenas em protótipo de balanceamento isolado. Métrica: frequência de virada, duração de liderança e justiça percebida.
4. Testar descrição curta de poderes e preview de dano/resultado antes de gastar. Métrica: compreensão e arrependimento de uso.

Não há dados de jogadores ou baseline. As hipóteses acima só devem virar mudança após playtest e aprovação de escopo.
