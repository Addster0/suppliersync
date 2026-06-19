import { VENDOR_TEMPLATES, type VendorTemplate } from "../lib/vendorTemplates";

type Props = {
  selectedId?: string;
  onSelect: (template: VendorTemplate) => void;
};

export function VendorTemplatePicker({ selectedId, onSelect }: Props) {
  return (
    <div className="vendor-template-picker">
      <p className="label">Quick pick a vendor type</p>
      <div className="vendor-template-chips">
        {VENDOR_TEMPLATES.map((template) => (
          <button
            className={`vendor-template-chip${selectedId === template.id ? " is-selected" : ""}`}
            key={template.id}
            onClick={() => onSelect(template)}
            type="button"
          >
            {template.label}
          </button>
        ))}
      </div>
    </div>
  );
}
