import { LocalNotifications } from "@capacitor/local-notifications";
import type { PomodoroPhase, PomodoroState } from "../appState";
import { el } from "./dom";
import { setIcon } from "./icons";
import { formatClock } from "../dates";
import type { AppContext } from "./context";

const PHASE_LABEL: Record<PomodoroPhase, string> = {
	work: "Focus",
	short: "Short break",
	long: "Long break",
};

/**
 * Singleton focus timer. Remaining time is derived from `endsAt` timestamps so
 * it stays correct across app suspension; focus seconds accrue to the selected
 * task while a work phase runs. Fires a local notification when a phase ends.
 */
class PomodoroController {
	private ctx: PomodoroContext | null = null;
	private card: HTMLElement | null = null;
	private clockEl: HTMLElement | null = null;
	private tick: number | null = null;
	private notifReady = false;

	attach(ctx: PomodoroContext, parent: HTMLElement): void {
		this.ctx = ctx;
		if (!ctx.settings.pomodoroConfig.enabled) return;
		if (!ctx.settings.pomodoro) ctx.settings.pomodoro = this.freshState("work");
		this.card = el("div", { cls: "pomodoro" });
		parent.append(this.card);
		this.build();
		this.ensureTick();
	}

	private get state(): PomodoroState {
		return this.ctx!.settings.pomodoro!;
	}

	private freshState(phase: PomodoroPhase): PomodoroState {
		return {
			phase,
			running: false,
			endsAt: null,
			remainingMs: this.phaseMs(phase),
			completedWork: 0,
			taskName: null,
			focusStartedAt: null,
		};
	}

	private phaseMs(phase: PomodoroPhase): number {
		const c = this.ctx!.settings.pomodoroConfig;
		const mins = phase === "work" ? c.workMin : phase === "short" ? c.shortMin : c.longMin;
		return mins * 60_000;
	}

	private remainingMs(): number {
		const s = this.state;
		if (s.running && s.endsAt !== null) return Math.max(0, s.endsAt - Date.now());
		return s.remainingMs;
	}

	private build(): void {
		if (!this.card) return;
		const s = this.state;
		this.card.replaceChildren();
		this.card.className = `pomodoro phase-${s.phase}${s.running ? " is-running" : ""}`;

		const head = el("div", { cls: "pomodoro-head" });
		const ic = el("span", { cls: "pomodoro-icon" });
		setIcon(ic, s.phase === "work" ? "timer" : "coffee");
		head.append(ic, el("span", { cls: "pomodoro-phase", text: PHASE_LABEL[s.phase] }));
		head.append(el("span", { cls: "pomodoro-cycle", text: `${s.completedWork % this.ctx!.settings.pomodoroConfig.longEvery}/${this.ctx!.settings.pomodoroConfig.longEvery}` }));
		this.card.append(head);

		this.clockEl = el("div", { cls: "pomodoro-clock", text: formatClock(this.remainingMs()) });
		this.card.append(this.clockEl);

		// Task picker (which task focus time accrues to).
		const picker = el("select", { cls: "pomodoro-task" }) as HTMLSelectElement;
		picker.append(el("option", { text: "No task", attrs: { value: "" } }));
		for (const name of this.ctx!.taskNames) {
			picker.append(el("option", { text: name, attrs: { value: name } }));
		}
		picker.value = s.taskName ?? "";
		picker.addEventListener("change", () => {
			this.commitFocus();
			s.taskName = picker.value || null;
			if (s.running && s.phase === "work") s.focusStartedAt = Date.now();
			void this.persist();
		});
		this.card.append(picker);

		const controls = el("div", { cls: "pomodoro-controls" });
		const playBtn = this.button(s.running ? "pause" : "play", s.running ? "Pause" : "Start");
		playBtn.addEventListener("click", () => (s.running ? this.pause() : this.start()));
		const skipBtn = this.button("chevron", "Skip");
		skipBtn.addEventListener("click", () => this.advance(false));
		const stopBtn = this.button("square", "Reset");
		stopBtn.addEventListener("click", () => this.reset());
		controls.append(playBtn, skipBtn, stopBtn);
		this.card.append(controls);
	}

	private button(icon: string, label: string): HTMLButtonElement {
		const b = el("button", { cls: "pomodoro-btn", attrs: { "aria-label": label } });
		const ic = el("span");
		setIcon(ic, icon);
		b.append(ic);
		return b as HTMLButtonElement;
	}

	private ensureTick(): void {
		if (this.tick !== null) return;
		this.tick = window.setInterval(() => this.onTick(), 500);
	}

	private onTick(): void {
		const s = this.ctx?.settings.pomodoro;
		if (!s || !this.clockEl) return;
		const rem = this.remainingMs();
		this.clockEl.textContent = formatClock(rem);
		if (s.running && rem <= 0) this.advance(true);
	}

	private start(): void {
		const s = this.state;
		s.running = true;
		s.endsAt = Date.now() + s.remainingMs;
		if (s.phase === "work") s.focusStartedAt = Date.now();
		void this.persist();
		this.build();
	}

	private pause(): void {
		const s = this.state;
		this.commitFocus();
		s.remainingMs = this.remainingMs();
		s.running = false;
		s.endsAt = null;
		s.focusStartedAt = null;
		void this.persist();
		this.build();
	}

	private reset(): void {
		const s = this.state;
		this.commitFocus();
		const fresh = this.freshState(s.phase);
		fresh.taskName = s.taskName;
		fresh.completedWork = s.completedWork;
		this.ctx!.settings.pomodoro = fresh;
		void this.persist();
		this.build();
	}

	/** Move to the next phase. `elapsed` = triggered by the clock hitting zero. */
	private advance(elapsed: boolean): void {
		const s = this.state;
		this.commitFocus();
		const c = this.ctx!.settings.pomodoroConfig;
		let completedWork = s.completedWork;
		let next: PomodoroPhase;
		if (s.phase === "work") {
			completedWork += 1;
			next = completedWork % c.longEvery === 0 ? "long" : "short";
		} else {
			next = "work";
		}
		if (elapsed) void this.notify(s.phase, next);
		const fresh = this.freshState(next);
		fresh.taskName = s.taskName;
		fresh.completedWork = completedWork;
		this.ctx!.settings.pomodoro = fresh;
		void this.persist();
		this.build();
	}

	/** Add the focus elapsed since `focusStartedAt` to the selected task. */
	private commitFocus(): void {
		const s = this.ctx?.settings.pomodoro;
		if (!s || s.phase !== "work" || !s.running || s.focusStartedAt === null) return;
		const secs = Math.floor((Date.now() - s.focusStartedAt) / 1000);
		if (secs > 0 && s.taskName) {
			const map = this.ctx!.settings.taskFocusSeconds;
			map[s.taskName] = (map[s.taskName] ?? 0) + secs;
		}
		s.focusStartedAt = s.running && s.phase === "work" ? Date.now() : null;
	}

	private async notify(fromPhase: PomodoroPhase, toPhase: PomodoroPhase): Promise<void> {
		try {
			if (!this.notifReady) {
				await LocalNotifications.requestPermissions();
				this.notifReady = true;
			}
			await LocalNotifications.schedule({
				notifications: [
					{
						id: Date.now() % 100000,
						title: fromPhase === "work" ? "Focus session done" : "Break over",
						body:
							toPhase === "work"
								? "Back to it — start your next focus session."
								: `Time for a ${toPhase === "long" ? "long" : "short"} break.`,
					},
				],
			});
		} catch {
			/* notifications unavailable (e.g. browser dev) — ignore */
		}
	}

	private async persist(): Promise<void> {
		await this.ctx!.persist();
	}
}

interface PomodoroContext {
	settings: AppContext["settings"];
	persist: AppContext["persist"];
	taskNames: string[];
}

const controller = new PomodoroController();

/** Render the focus timer into `parent`, given the current incomplete task names. */
export function renderPomodoro(ctx: AppContext, parent: HTMLElement, taskNames: string[]): void {
	controller.attach({ settings: ctx.settings, persist: ctx.persist, taskNames }, parent);
}
