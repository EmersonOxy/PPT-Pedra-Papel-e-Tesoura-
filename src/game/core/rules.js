const SIGNS = ['rock', 'paper', 'scissors'];
const NAMES = {rock:'Pedra',paper:'Papel',scissors:'Tesoura'};
const POWER_NAMES = {heal:'Cura',defense:'Defesa',critical:'Crítico'};
const POWERS = ['heal','defense','critical'];
const BEATS = {rock:'scissors',paper:'rock',scissors:'paper'};
const COUNTERS = {rock:'paper',paper:'scissors',scissors:'rock'};
const MAX_HP = 100, DAMAGE = 20, CRIT_DAMAGE = 30;
const POINTS_FOR_PRIZE = 3, POINTS_TO_WIN = 10, TURN_SECONDS = 5, MAX_MISSES = 3;
const random01 = rng => Math.min(0.999999999,Math.max(0, Number(rng()) || 0));
const randomItem = (items,rng) => items[Math.floor(random01(rng)*items.length)];
function outcome(player,enemy){
  if(!SIGNS.includes(player)||!SIGNS.includes(enemy)) throw new Error('Jogada inválida');
  return player===enemy?'draw':BEATS[player]===enemy?'win':'loss';
}
function createGame(){return {
  hp:MAX_HP,enemyHp:MAX_HP,playerPoints:0,enemyPoints:0,battle:1,phase:'playing',
  misses:0,matchWinner:null,finishReason:null,
  inventory:{player:[],enemy:[]},activeBuff:{player:null,enemy:null},
  playerHistory:[],lastPrize:null
};}
function powerCount(game,side,kind){return game.inventory[side].filter(p=>p===kind).length;}
// Ao gastar o item ele desaparece. Defesa e crítico valem somente para a jogada seguinte.
function activateAbility(game,side,kind,rng=Math.random){
  if(game.phase!=='playing'||!['player','enemy'].includes(side)||!POWERS.includes(kind)) return null;
  const bag=game.inventory[side],i=bag.indexOf(kind);
  if(i===-1) return null;
  const hpKey=side==='player'?'hp':'enemyHp';
  if(kind==='heal'&&game[hpKey]>=MAX_HP) return null;
  if(kind!=='heal'&&game.activeBuff[side]) return null;
  bag.splice(i,1);
  if(kind==='heal'){
    const rolled=10+Math.floor(random01(rng)*41);
    const restored=Math.min(MAX_HP-game[hpKey],rolled);
    game[hpKey]+=restored;
    return {kind,rolled,restored};
  }
  game.activeBuff[side]=kind;
  return {kind};
}
// Aprende padrões anteriores, inclusive a escolha que costuma vir após a última mão.
// Não recebe a mão atual do jogador: a decisão acontece ANTES do registro da jogada.
function chooseEnemySign(game,rng=Math.random){
  const history=game.playerHistory;
  if(history.length<3||random01(rng)<.25) return randomItem(SIGNS,rng);
  const counts={rock:.75,paper:.75,scissors:.75};
  const recent=history.slice(-12);
  recent.forEach((sign,i)=>{counts[sign]+=.65+(i/recent.length)*.8;});
  const previous=history.at(-1);
  for(let i=1;i<history.length;i++){
    if(history[i-1]===previous) counts[history[i]]+=2.2;
  }
  if(history.length>=2&&history.at(-2)===previous) counts[previous]+=1.5;
  const ranked=SIGNS.slice().sort((a,b)=>counts[b]-counts[a]);
  const picked=random01(rng)<.79?ranked[0]:ranked[1];
  return COUNTERS[picked];
}
// A IA usa a habilidade sem saber qual mão o jogador vai escolher.
function chooseEnemyAbility(game,rng=Math.random){
  const inv=game.inventory.enemy;
  if(game.activeBuff.enemy) return null;
  if(inv.includes('heal')&&game.enemyHp<=45) return activateAbility(game,'enemy','heal',rng);
  if(inv.includes('defense')&&game.enemyHp<=60&&random01(rng)<.70) return activateAbility(game,'enemy','defense',rng);
  if(inv.includes('critical')&&game.hp<=60&&random01(rng)<.75) return activateAbility(game,'enemy','critical',rng);
  return null;
}
function awardBattle(game,winner,rng=Math.random){
  const loser=winner==='player'?'enemy':'player';
  const key=winner==='player'?'playerPoints':'enemyPoints';
  game[key]++;
  const transferred=game.inventory[loser].splice(0);
  game.inventory[winner].push(...transferred);
  let unlocked=null;
  if(game[key]%POINTS_FOR_PRIZE===0&&game[key]<POINTS_TO_WIN){
    unlocked=randomItem(POWERS,rng);
    game.inventory[winner].push(unlocked);
    game.lastPrize={owner:winner,kind:unlocked,battle:game.battle};
  }
  if(game[key]>=POINTS_TO_WIN){
    game.phase='finished';game.matchWinner=winner;game.finishReason='points';
  }else game.phase=winner==='player'?'won':'lost';
  return {winner,transferred,unlocked};
}
function play(game,sign,rng=Math.random){
  if(game.phase!=='playing'||!SIGNS.includes(sign)) return null;
  const enemyAbility=chooseEnemyAbility(game,rng);
  const enemy=chooseEnemySign(game,rng); // a escolha da IA não utiliza `sign`.
  const result=outcome(sign,enemy);
  const buffs={...game.activeBuff};
  let damage=0;
  if(result!=='draw'){
    const attacker=result==='win'?'player':'enemy';
    const defender=result==='win'?'enemy':'player';
    damage=buffs[attacker]==='critical'?CRIT_DAMAGE:DAMAGE;
    if(buffs[defender]==='defense') damage=Math.ceil(damage/2);
    const hpKey=defender==='player'?'hp':'enemyHp';
    game[hpKey]=Math.max(0,game[hpKey]-damage);
  }
  // Buffs são sempre de uma jogada: no empate ou na mão errada também expiram.
  game.activeBuff.player=null; game.activeBuff.enemy=null;
  game.playerHistory.push(sign);
  if(game.playerHistory.length>35) game.playerHistory.shift();
  let battleResult=null;
  if(game.enemyHp===0) battleResult=awardBattle(game,'player',rng);
  else if(game.hp===0) battleResult=awardBattle(game,'enemy',rng);
  return {sign,enemy,result,damage,buffs,enemyAbility,battleResult};
}
function nextBattle(game){
  if(!['won','lost'].includes(game.phase)) return false;
  game.hp=game.enemyHp=MAX_HP;
  game.activeBuff.player=null;game.activeBuff.enemy=null;
  game.battle++;game.phase='playing';return true;
}
function missChoice(game){
  if(game.phase!=='playing') return false;
  game.misses++;
  if(game.misses>=MAX_MISSES){
    game.phase='finished';game.matchWinner='enemy';game.finishReason='timeout';return true;
  }
  return false;
}

export { SIGNS, NAMES, POWER_NAMES, POWERS, BEATS, COUNTERS, MAX_HP, DAMAGE, CRIT_DAMAGE, POINTS_FOR_PRIZE, POINTS_TO_WIN, TURN_SECONDS, MAX_MISSES, random01, randomItem, outcome, createGame, powerCount, activateAbility, chooseEnemySign, chooseEnemyAbility, awardBattle, play, nextBattle, missChoice };
