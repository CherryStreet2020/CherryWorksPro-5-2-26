import { useState } from "react";
import { PLAN_PRICING } from "@shared/plan-pricing";

function money(n: number) {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/**
 * Lets a visitor price their own team: the per-user figure is theirs to type,
 * so the page never quotes a competitor's price that may have changed.
 */
export function SeatCalculator() {
  const [team, setTeam] = useState(8);
  const [seat, setSeat] = useState("15");
  const flat = PLAN_PRICING.PROFESSIONAL.monthly;
  const perUser = Math.max(0, Number(seat) || 0);
  const perSeat = team * perUser;
  const saving = perSeat - flat;
  const breakEven = perUser > 0 ? Math.floor(flat / perUser) + 1 : null;

  return (
    <div className="grid border-t border-[#E6E3DD] md:grid-cols-2" data-testid="seat-calculator">
      <div className="py-8 md:pr-12">
        <label htmlFor="calc-team" className="flex items-baseline justify-between text-[15px] font-medium text-[#15171C]">
          People on your team
          <span className="text-[28px] tracking-[-0.02em]" data-testid="calc-team-value">{team}</span>
        </label>
        <input
          id="calc-team"
          type="range"
          min={1}
          max={50}
          value={team}
          onChange={(e) => setTeam(Number(e.target.value))}
          className="mt-4 w-full accent-[#15171C]"
          data-testid="input-calc-team"
        />
        <label htmlFor="calc-seat" className="mt-8 block text-[15px] font-medium text-[#15171C]">
          What your current tool charges per user, per month
        </label>
        <div className="mt-2 flex h-11 items-center rounded-full border border-[#D5D2CB] bg-white px-5 focus-within:border-[#15171C]">
          <span className="text-[#5C606A]">$</span>
          <input
            id="calc-seat"
            type="number"
            inputMode="decimal"
            min={0}
            step={1}
            value={seat}
            onChange={(e) => setSeat(e.target.value)}
            className="w-full bg-transparent pl-1 text-[15px] text-[#15171C] outline-none"
            data-testid="input-calc-seat"
          />
        </div>
        <p className="mt-3 text-[14px] text-[#6E727B]">Check your last invoice. Add-ons charged per user count too.</p>
      </div>

      <div className="flex flex-col justify-between border-t border-[#E6E3DD] py-8 md:border-l md:border-t-0 md:pl-12" data-testid="calc-result" aria-live="polite">
        <dl className="space-y-5">
          <div className="flex items-baseline justify-between gap-4 border-b border-[#E6E3DD] pb-5">
            <dt className="text-[15px] text-[#5C606A]">Per-user pricing</dt>
            <dd className="text-right">
              <span className="text-[32px] font-medium tracking-[-0.03em] text-[#15171C]">{money(perSeat)}</span>
              <span className="text-[14px] text-[#6E727B]"> /mo</span>
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-[15px] text-[#5C606A]">
              CherryWorks Pro Professional
              <span className="block text-[13px] text-[#6E727B]">Unlimited users, clients and projects</span>
            </dt>
            <dd className="text-right">
              <span className="text-[32px] font-medium tracking-[-0.03em] text-[#15171C]">{money(flat)}</span>
              <span className="text-[14px] text-[#6E727B]"> /mo</span>
            </dd>
          </div>
        </dl>
        <p className="mt-8 text-[16px] leading-relaxed text-[#15171C]" data-testid="calc-verdict">
          {perUser === 0
            ? "Enter your per-user price to compare."
            : saving > 0
              ? <>You’d keep <strong className="font-medium">{money(saving)} a month</strong>, {money(saving * 12)} a year, and the gap grows with every hire.</>
              : <>At {team} {team === 1 ? "person" : "people"}, per-user pricing costs less. Flat pricing pulls ahead at {breakEven} people and stays flat after that.</>}
        </p>
      </div>
    </div>
  );
}
