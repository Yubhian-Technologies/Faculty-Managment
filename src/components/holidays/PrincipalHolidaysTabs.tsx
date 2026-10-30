import { SegmentedTabs } from "@/components/shared/SegmentedTabs";

// Compensatory Sundays is an option inside the Holidays module for the Principal / Vice Principal,
// not a module of its own, so both screens carry the same two tabs.
export function PrincipalHolidaysTabs({ active }: { active: "holidays" | "compensatory" }) {
  return (
    <SegmentedTabs
      value={active}
      options={[
        { key: "holidays", label: "Holidays", href: "/principal/holiday-calendar" },
        { key: "compensatory", label: "Compensatory Sundays", href: "/principal/holidays" },
      ]}
    />
  );
}
