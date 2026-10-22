import { useEffect, useState } from 'react';

export const PHONE_LAYOUT_QUERY = '(max-width: 600px)';

/** iPhone 宽度判断：手机端收起独立题库入口，并改用纵向布局。 */
export function usePhoneLayout(): boolean {
  const [phone, setPhone] = useState(() => window.matchMedia(PHONE_LAYOUT_QUERY).matches);
  useEffect(() => {
    const media = window.matchMedia(PHONE_LAYOUT_QUERY);
    const update = () => setPhone(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return phone;
}
