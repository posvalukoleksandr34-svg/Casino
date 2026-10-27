'use client';

import { ReasonedAction } from './reasoned-action';

/** Owner control: require two-factor authentication for every staff session. */
export function StaffMfaPolicy({ required, canEnable }: { required: boolean; canEnable: boolean }) {
  return (
    <ReasonedAction
      label={required ? 'Stop requiring MFA for staff' : 'Require MFA for all staff'}
      title={required ? 'Stop requiring MFA for staff' : 'Require MFA for all staff'}
      description={
        required
          ? 'Staff will be able to use the back office with a password alone.'
          : 'Staff sessions that have not passed two-factor authentication will only be able to open this security page until they set it up or verify. Players are not affected.'
      }
      variant={required ? 'secondary' : 'primary'}
      disabled={!required && !canEnable}
      path="/api/admin/security"
      body={(reason) => ({ staffMfaRequired: !required, reason })}
    />
  );
}
