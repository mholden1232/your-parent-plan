(function(){
  async function getMembership(){
    const client = window.yppAuthClient;
    if(!client) return {tier:'free', status:'inactive', isPlus:false};

    const { data: userData, error: userError } = await client.auth.getUser();
    if(userError || !userData || !userData.user){
      return {tier:'free', status:'inactive', isPlus:false};
    }

    const user = userData.user;
    const { data, error } = await client
      .from('memberships')
      .select('tier,status')
      .eq('user_id', user.id)
      .maybeSingle();

    if(error){
      console.warn('Membership lookup failed:', error.message);
      return {tier:'free', status:'inactive', isPlus:false, error};
    }

    const tier = data?.tier || 'free';
    const status = data?.status || 'inactive';
    const isPlus = status === 'active' && (tier === 'plus_monthly' || tier === 'plus_annual');
    return {tier, status, isPlus};
  }

  window.yppGetMembership = getMembership;

  document.addEventListener('DOMContentLoaded', async ()=>{
    const areas = document.querySelectorAll('[data-membership-gate]');
    if(!areas.length) return;

    const membership = await getMembership();
    areas.forEach(area=>{
      area.dataset.membership = membership.isPlus ? 'plus' : 'free';

      const locked = area.querySelector('[data-gate-locked]');
      const unlocked = area.querySelector('[data-gate-unlocked]');
      if(locked) locked.hidden = membership.isPlus;
      if(unlocked) unlocked.hidden = !membership.isPlus;

      const badge = area.querySelector('[data-membership-badge]');
      if(badge){
        badge.textContent = membership.isPlus
          ? (membership.tier === 'plus_annual' ? 'PLUS ANNUAL' : 'PLUS MONTHLY')
          : 'PLUS MEMBERSHIP';
      }
    });
  });
})();
