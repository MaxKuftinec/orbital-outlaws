<script lang="ts">
import { defineComponent } from 'vue'
import '../pilot-profile.css'

type PilotProfileData = {
  id: string
  username: string
  email: string
  verified: boolean
  avatar_id: string
  created_at: number
}
type Stage = 'login' | 'register' | 'verify' | 'reset-request' | 'reset-confirm' | 'profile'
const TOKEN_KEY = 'orbital-outlaws.account.session.v1'
const ACCOUNT_KEY = 'orbital-outlaws.account.id.v1'
const avatars = [
  { id: 'vanguard', title: 'Vanguard', tagline: 'Flight pathfinder', designation: 'FLIGHT / 01' },
  { id: 'navigator', title: 'Navigator', tagline: 'Orbital tactician', designation: 'NAV / 02' },
  { id: 'salvager', title: 'Salvager', tagline: 'Frontier engineer', designation: 'INDUSTRY / 03' },
  { id: 'envoy', title: 'Envoy', tagline: 'Deep-space diplomat', designation: 'CIVIC / 04' },
  { id: 'mechanic', title: 'Mechanic', tagline: 'Systems specialist', designation: 'WORKSHOP / 05' },
  { id: 'sentinel', title: 'Sentinel', tagline: 'Armored explorer', designation: 'DEFENSE / 06' },
]
export default defineComponent({
  name: 'PilotProfile',
  data() {
    return {
      open: false,
      stage: 'login' as Stage,
      busy: false,
      error: '',
      message: '',
      registration: { email: '', username: '', password: '', confirm: '' },
      login: { identifier: '', password: '' },
      verification: { identifier: '', code: '' },
      reset: { identifier: '', code: '', password: '', confirm: '' },
      chosenAvatar: 'navigator',
      profile: null as PilotProfileData | null,
      token: '',
      avatars
    }
  },
  mounted() {
    this.token = sessionStorage.getItem(TOKEN_KEY) || ''
    if (this.token) void this.refresh()
  },
  methods: {
    publishSession() {
      if (this.token && this.profile) {
        sessionStorage.setItem(ACCOUNT_KEY, this.profile.id)
      } else {
        sessionStorage.removeItem(ACCOUNT_KEY)
      }
      window.dispatchEvent(new Event('orbital-auth'))
    },
    show() {
      this.open = true
      this.error = ''
      this.message = ''
      if (this.profile) this.stage = 'profile'
    },
    setStage(stage: Stage) {
      this.stage = stage
      this.error = ''
      this.message = ''
    },
    async api(path: string, method: string, body?: object, authenticated = false) {
      const base = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
      const response = await fetch(base + '/auth' + path, {
        method,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(authenticated ? { Authorization: 'Bearer ' + this.token } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        cache: 'no-store'
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) {
        const detail = result.detail
        throw new Error(typeof detail === 'string' ? detail :
          response.status === 503 ? 'Accounts are not yet enabled on this server.' :
          response.status === 401 ? 'Incorrect credentials or expired session.' :
          'Request failed. Please check your details.')
      }
      return result
    },
    async submitRegister() {
      if (this.registration.password !== this.registration.confirm) {
        this.error = 'Both password fields must match.'
        return
      }
      this.error = ''
      this.busy = true
      try {
        await this.api('/register', 'POST', {
          email: this.registration.email,
          username: this.registration.username,
          password: this.registration.password,
          avatar_id: this.chosenAvatar
        })
        this.verification.identifier = this.registration.email
        this.registration.password = ''
        this.registration.confirm = ''
        this.stage = 'verify'
        this.message = 'We sent a six-digit verification code. Check your inbox.'
      } catch (e) {
        this.error = (e as Error).message
      } finally {
        this.busy = false
      }
    },
    async submitVerification() {
      this.error = ''
      this.busy = true
      try {
        await this.api('/verify', 'POST', {
          identifier: this.verification.identifier,
          code: this.verification.code.trim()
        })
        this.login.identifier = this.verification.identifier
        this.verification.code = ''
        this.stage = 'login'
        this.message = 'Account verified. You can sign in now.'
      } catch (e) {
        this.error = (e as Error).message
      } finally {
        this.busy = false
      }
    },
    async resendCode() {
      this.error = ''
      this.busy = true
      try {
        await this.api('/resend', 'POST', { identifier: this.verification.identifier })
        this.message = 'If your account is pending, another code is on its way.'
      } catch (e) {
        this.error = (e as Error).message
      } finally {
        this.busy = false
      }
    },
    async submitLogin() {
      this.error = ''
      this.busy = true
      try {
        const answer = await this.api('/login', 'POST', this.login)
        this.token = answer.access_token
        sessionStorage.setItem(TOKEN_KEY, this.token)
        this.profile = answer.profile
        this.publishSession()
        this.chosenAvatar = this.profile?.avatar_id || 'navigator'
        this.login.password = ''
        this.stage = 'profile'
        this.message = 'Welcome to the frontier, ' + (this.profile?.username || 'pilot') + '.'
      } catch (e) {
        this.error = (e as Error).message
        this.login.password = ''
      } finally {
        this.busy = false
      }
    },
    async refresh() {
      try {
        this.profile = await this.api('/me', 'GET', undefined, true)
        this.chosenAvatar = this.profile?.avatar_id || 'navigator'
        this.stage = 'profile'
        this.publishSession()
      } catch {
        this.token = ''
        this.profile = null
        sessionStorage.removeItem(TOKEN_KEY)
        this.publishSession()
      }
    },
    async chooseAvatar(id: string) {
      if (!this.avatars.some(a => a.id === id)) return
      this.chosenAvatar = id
      if (!this.profile) return
      this.busy = true
      this.error = ''
      try {
        this.profile = await this.api('/me/avatar', 'PATCH', { avatar_id: id }, true)
        this.message = 'Profile portrait saved.'
      } catch (e) {
        this.error = (e as Error).message
      } finally {
        this.busy = false
      }
    },
    async logout() {
      try {
        if (this.token) await this.api('/logout', 'POST', undefined, true)
      } catch { /* Expired sessions are cleared locally as well. */ }
      this.profile = null
      this.token = ''
      sessionStorage.removeItem(TOKEN_KEY)
      this.publishSession()
      this.stage = 'login'
      this.message = 'Signed out.'
    },
    async requestReset() {
      this.error = ''
      this.message = ''
      this.busy = true
      try {
        await this.api('/password-reset/request','POST',{identifier:this.reset.identifier})
        this.stage = 'reset-confirm'
        this.message = 'If that account exists, a six-digit recovery code was sent.'
      } catch (e) {
        this.error = (e as Error).message
      } finally {
        this.busy = false
      }
    },
    async confirmReset() {
      if (this.reset.password !== this.reset.confirm) {
        this.error = 'Both password fields must match.'
        return
      }
      this.error = ''
      this.busy = true
      try {
        await this.api('/password-reset/confirm','POST',{
          identifier:this.reset.identifier,code:this.reset.code,
          new_password:this.reset.password
        })
        this.login.identifier = this.reset.identifier
        this.reset.code = ''
        this.reset.password = ''
        this.reset.confirm = ''
        this.stage = 'login'
        this.message = 'Password updated. Sign in with your new password.'
      } catch (e) {
        this.error = (e as Error).message
      } finally {
        this.busy = false
      }
    }
  }
})
</script>

<template>
  <v-dialog v-model="open" max-width="1050" scrollable content-class="pilot-profile-dialog">
    <section class="pilot-account" aria-label="Orbital Outlaws pilot identity">
      <header class="pilot-account-header">
        <div><span class="pilot-kicker">ORBITAL OUTLAWS / PILOT REGISTRY</span><h2>{{ stage === 'profile' ? 'PILOT DOSSIER' : 'CLAIM YOUR CALLSIGN' }}</h2>
          <p>Every legend begins with an identity. No personal photograph required.</p></div>
        <button type="button" class="pilot-close" aria-label="Close pilot registry" @click="open=false">✕</button>
      </header>
      <div class="pilot-account-content">
        <aside class="pilot-art-gallery">
          <div class="pilot-featured">
            <img :src="'/avatars/'+chosenAvatar+'.svg'" alt="Selected fictional pilot character portrait" />
            <div class="pilot-featured-caption"><span>SELECTED IDENTITY</span><strong>{{ avatars.find(a=>a.id===chosenAvatar)?.title }}</strong>
              <small>{{ avatars.find(a=>a.id===chosenAvatar)?.tagline }}</small></div>
          </div>
          <div class="pilot-portrait-grid" role="group" aria-label="Select fictional pilot portrait">
            <button v-for="avatar in avatars" :key="avatar.id" type="button" class="pilot-avatar-option"
              :class="{selected:chosenAvatar===avatar.id}" :aria-pressed="chosenAvatar===avatar.id"
              :aria-label="'Choose '+avatar.title+' portrait'" :disabled="busy"
              @click="chooseAvatar(avatar.id)">
              <img :src="'/avatars/'+avatar.id+'.svg'" :alt="avatar.title+' character portrait'" loading="lazy" />
              <span>{{ avatar.title }}</span>
            </button>
          </div>
          <p class="pilot-art-footnote">Portraits define appearance only. They do not affect attributes, abilities, or gameplay balance.</p>
        </aside>
        <div class="pilot-form-panel">
          <div v-if="stage==='login'||stage==='register'" class="pilot-form-tabs" role="tablist" aria-label="Account access">
            <button type="button" :class="{active:stage==='login'}" :aria-selected="stage==='login'" @click="setStage('login')">Sign in</button>
            <button type="button" :class="{active:stage==='register'}" :aria-selected="stage==='register'" @click="setStage('register')">Create account</button>
          </div>
          <form v-if="stage==='register'" class="pilot-form" @submit.prevent="submitRegister">
            <span class="pilot-panel-kicker">NEW PLAYER / REGISTRATION</span><h3>Join the frontier</h3>
            <p>Reserve a unique callsign and verify your email to activate your profile.</p>
            <label>Callsign <small>3–20 letters, digits or underscores</small><input v-model.trim="registration.username" autocomplete="username" minlength="3" maxlength="20" pattern="[A-Za-z][A-Za-z0-9_]{2,19}" required placeholder="e.g. orbital_pioneer"/></label>
            <label>Email address<input v-model.trim="registration.email" type="email" autocomplete="email" required placeholder="pilot@example.com"/></label>
            <label>Password <small>At least 12 characters</small><input v-model="registration.password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required placeholder="Choose a strong password"/></label>
            <label>Confirm password<input v-model="registration.confirm" type="password" autocomplete="new-password" minlength="12" required placeholder="Repeat your password"/></label>
            <button class="pilot-primary" type="submit" :disabled="busy">{{ busy?'REGISTERING…':'CREATE PILOT ACCOUNT' }}</button>
          </form>
          <form v-else-if="stage==='verify'" class="pilot-form" @submit.prevent="submitVerification">
            <span class="pilot-panel-kicker">IDENTITY / EMAIL VERIFICATION</span><h3>Check your transmission</h3>
            <p>Enter the six digits sent to your inbox. Codes expire after 10 minutes.</p>
            <label>Email or callsign<input v-model.trim="verification.identifier" autocomplete="username" required /></label>
            <label>Verification code<input v-model.trim="verification.code" class="pilot-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" minlength="6" pattern="[0-9]{6}" required placeholder="000000" /></label>
            <button class="pilot-primary" type="submit" :disabled="busy">{{ busy?'VERIFYING…':'VERIFY ACCOUNT' }}</button>
            <div class="pilot-secondary-actions"><button type="button" :disabled="busy" @click="resendCode">Resend code</button><button type="button" @click="setStage('login')">Back to sign in</button></div>
          </form>
          <form v-else-if="stage==='login'" class="pilot-form" @submit.prevent="submitLogin">
            <span class="pilot-panel-kicker">RETURNING PLAYER / ACCESS</span><h3>Welcome aboard</h3>
            <p>Sign in using your callsign or verified email address.</p>
            <label>Email or callsign<input v-model.trim="login.identifier" autocomplete="username" required placeholder="Email or callsign" /></label>
            <label>Password<input v-model="login.password" type="password" autocomplete="current-password" required placeholder="Your account password"/></label>
            <button class="pilot-primary" type="submit" :disabled="busy">{{ busy?'SIGNING IN…':'SIGN IN' }}</button>
            <div class="pilot-secondary-actions"><button type="button" @click="verification.identifier=login.identifier;setStage('verify')">Enter verification code</button><button type="button" @click="reset.identifier=login.identifier;setStage('reset-request')">Forgot password?</button></div>
          </form>
          <form v-else-if="stage==='reset-request'" class="pilot-form" @submit.prevent="requestReset">
            <span class="pilot-panel-kicker">ACCOUNT RECOVERY</span><h3>Recover your flight credentials</h3>
            <p>We'll send a short-lived recovery code to the account's verified email.</p>
            <label>Email or callsign<input v-model.trim="reset.identifier" autocomplete="username" required /></label>
            <button class="pilot-primary" type="submit" :disabled="busy">{{ busy?'SENDING…':'SEND RECOVERY CODE' }}</button>
            <div class="pilot-secondary-actions"><button type="button" @click="setStage('login')">Back to sign in</button></div>
          </form>
          <form v-else-if="stage==='reset-confirm'" class="pilot-form" @submit.prevent="confirmReset">
            <span class="pilot-panel-kicker">ACCOUNT RECOVERY</span><h3>Set a new password</h3>
            <label>Email or callsign<input v-model.trim="reset.identifier" autocomplete="username" required /></label>
            <label>Six-digit recovery code<input v-model.trim="reset.code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required /></label>
            <label>New password<input v-model="reset.password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required /></label>
            <label>Confirm password<input v-model="reset.confirm" type="password" autocomplete="new-password" minlength="12" required /></label>
            <button class="pilot-primary" type="submit" :disabled="busy">{{ busy?'UPDATING…':'UPDATE PASSWORD' }}</button>
            <div class="pilot-secondary-actions"><button type="button" :disabled="busy" @click="requestReset">Resend code</button><button type="button" @click="setStage('login')">Back to sign in</button></div>
          </form>
          <div v-else-if="profile" class="pilot-dossier">
            <span class="pilot-panel-kicker">REGISTRY / VERIFIED PILOT</span><h3>{{ profile.username }}</h3>
            <p><span class="pilot-verified">✓ VERIFIED</span> &nbsp; {{ profile.email }}</p>
            <dl><div><dt>Identity</dt><dd>Independent civilian pilot</dd></div>
              <div><dt>Portrait</dt><dd>{{ avatars.find(a=>a.id===chosenAvatar)?.title }}</dd></div>
              <div><dt>Alliances</dt><dd>Not yet available</dd></div>
              <div><dt>Flight persistence</dt><dd>Live server pilot</dd></div><div><dt>Pilot ID</dt><dd><code>{{ profile.id }}</code></dd></div></dl>
            <p class="pilot-dossier-note">Your account owns a persistent flight on the server. Sign out to disconnect flight controls.</p>
            <button type="button" class="pilot-outline" @click="logout">Sign out</button>
          </div>
          <p v-if="error" role="alert" class="pilot-feedback error">{{ error }}</p>
          <p v-if="message" role="status" class="pilot-feedback success">{{ message }}</p>
          <div class="pilot-footnote"><span class="pilot-status-dot"></span> ACCOUNT SYSTEM / EARLY ACCESS
            <span>Alliance affiliations and social features are planned for a later release.</span></div>
        </div>
      </div>
    </section>
  </v-dialog>
</template>
