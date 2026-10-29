import { HugeiconsIcon, type HugeiconsIconProps, type IconSvgElement } from "@hugeicons/react";
import {
  AlertCircleIcon,
  ArrowRight02Icon,
  ArrowUpRight01Icon,
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  Copy01Icon,
  CreditCardIcon,
  CursorPointer01Icon,
  FlashIcon,
  Invoice03Icon,
  LinkSquare02Icon,
  Loading03Icon,
  QuillWrite01Icon,
  SecurityCheckIcon,
  SquareLock02Icon,
  Tick02Icon,
  UserGroupIcon,
  ViewIcon,
} from "@hugeicons/core-free-icons";

export type Glyph = IconSvgElement;

/** Hugeicons free set (MIT), stroke style, one stroke weight across the app. */
export const I = {
  alert: AlertCircleIcon,
  arrowRight: ArrowRight02Icon,
  arrowUpRight: ArrowUpRight01Icon,
  cancel: CancelCircleIcon,
  checkCircle: CheckmarkCircle02Icon,
  copy: Copy01Icon,
  creditCard: CreditCardIcon,
  cursor: CursorPointer01Icon,
  flash: FlashIcon,
  invoice: Invoice03Icon,
  external: LinkSquare02Icon,
  loading: Loading03Icon,
  quill: QuillWrite01Icon,
  shield: SecurityCheckIcon,
  lock: SquareLock02Icon,
  tick: Tick02Icon,
  users: UserGroupIcon,
  view: ViewIcon,
} as const;

export function Icon({ icon, size = 16, strokeWidth = 1.8, ...rest }: HugeiconsIconProps) {
  const labelled = "aria-label" in rest && rest["aria-label"];
  return (
    <HugeiconsIcon
      icon={icon}
      size={size}
      strokeWidth={strokeWidth}
      aria-hidden={labelled ? undefined : true}
      role={labelled ? "img" : undefined}
      {...rest}
    />
  );
}
