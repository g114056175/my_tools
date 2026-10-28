export function createJobAdmission(limit = 20) {
  let reserved = 0;
  return {
    reserve(activeCount) {
      if (activeCount + reserved >= limit) return null;
      reserved++;
      let held = true;
      return () => {
        if (!held) return;
        held = false;
        reserved--;
      };
    },
    get reserved() {
      return reserved;
    },
  };
}
