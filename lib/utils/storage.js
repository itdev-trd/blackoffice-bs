// เก็บ/อ่านสถานะ UI ลง localStorage (กันรีเฟรชแล้วหลุดหน้า/ต้องดึงข้อมูลใหม่)
export const lsGet = (k, d) => {
  try {
    const v = localStorage.getItem(k);
    return v == null ? d : JSON.parse(v);
  } catch {
    return d;
  }
};

export const lsSet = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* ignore */
  }
};
