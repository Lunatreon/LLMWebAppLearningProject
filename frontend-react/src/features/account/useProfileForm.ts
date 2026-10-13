import { useEffect, useRef, useState } from 'react';
import { useSession } from '../../hooks/useSession';
import { ApiError } from '../../services/apiClient';
import { updateProfile } from './accountApi';
import { profileLengthsValid, profilePayload, profileValues, sameProfile } from './types';
import type { AccountResponse, ProfileValues } from './types';

export function useProfileForm(account: AccountResponse, token: string) {
  const { controller } = useSession();
  const [form, setForm] = useState(() => ({
    values: profileValues(account),
    baseline: profileValues(account),
    saving: false,
    status: '',
  }));
  const pending = useRef(false);
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const values = profileValues(account);
    setForm((previous) =>
      !previous.saving &&
      sameProfile(previous.values, previous.baseline) &&
      !sameProfile(previous.baseline, values)
        ? { values, baseline: values, saving: false, status: '' }
        : previous,
    );
  }, [account]);

  function setField(field: keyof ProfileValues, value: string) {
    setForm((previous) => ({ ...previous, values: { ...previous.values, [field]: value } }));
  }

  async function save() {
    if (pending.current || token !== controller.getToken() || !profileLengthsValid(form.values))
      return;
    pending.current = true;
    setForm((previous) => ({ ...previous, saving: true, status: 'Saving...' }));
    try {
      const result = await updateProfile(controller.api, profilePayload(form.values), token);
      if (token !== controller.getToken()) return;
      if (result.id !== account.id)
        throw new ApiError('The FeelY backend returned an account for a different session.', 502);
      if (!controller.applyAccountResponse(result, token)) {
        // A concurrent session refresh may have replaced the authenticated state.
        // Read again after the commit rather than reviving an older capability snapshot.
        await controller.reload({ force: true });
      }
      if (alive.current && token === controller.getToken()) {
        const values = profileValues(result);
        setForm({ values, baseline: values, saving: false, status: 'Saved.' });
      }
    } catch (error) {
      if (alive.current && token === controller.getToken()) {
        setForm((previous) => ({
          ...previous,
          status: error instanceof Error ? error.message : String(error),
        }));
      }
    } finally {
      pending.current = false;
      if (alive.current && token === controller.getToken())
        setForm((previous) => ({ ...previous, saving: false }));
    }
  }

  return { ...form, dirty: !sameProfile(form.values, form.baseline), setField, save };
}
