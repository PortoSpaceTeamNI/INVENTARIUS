package parts

import "testing"

func TestFootprint(t *testing.T) {
	for _, tc := range []struct{ mpn, desc, want string }{
		// Descriptions as Mouser's API gives them.
		{"CL05X105KO5NQWC", "Multilayer Ceramic Capacitors MLCC - SMD/SMT X6S, 1uF, +/-10%, 16v, 0402", "0402"},
		{"RC0603FR-0710KL", "Thick Film Resistors - SMD General Purpose Chip Resistor 0603, 10kOhms, 1%, 1/10W", "0603"},
		{"BSS138", "MOSFETs SOT-23 N-CH LOGIC", "SOT-23"},
		{"XYZ", "Something in a soic-8 package", "SOIC-8"},
		// From the part number.
		{"GRM188R71H104KA93D", "Multilayer Ceramic Capacitors MLCC - SMD/SMT RECOMMENDED ALT 81-GRM188R72A104KA35", "0603"},
		{"STM32F405RGT6", "ARM Microcontrollers - MCU ARM M4 1024 FLASH 168 Mhz 192kB SRAM", "LQFP-64"},
		{"STM32G431CBU6", "", "QFN-48"},
		{"ERJ-3EKF1002V", "", "0603"},
		{"ERJ-14NF1002U", "", "1210"},
		{"C1608X7R1H104K080AA", "", "0603"},
		{"C0603C104K5RACTU", "", "0603"},
		// Nothing to go on.
		{"LM358P", "Operational Amplifiers - Op Amps Dual Op Amp", ""},
		{"BMP390", "Board Mount Pressure Sensors High Performance Barometric Pressure Sensor for Altitude Tracking", ""},
	} {
		if got := Footprint(tc.mpn, tc.desc); got != tc.want {
			t.Errorf("Footprint(%q, %q) = %q, want %q", tc.mpn, tc.desc, got, tc.want)
		}
	}
}

func TestGroupOf(t *testing.T) {
	for cat, want := range map[string]string{
		"Multilayer Ceramic Capacitors MLCC - SMD/SMT": "Condensadores",
		"Thick Film Resistors - SMD":                   "Resistências",
		"Current Sense Resistors - SMD":                "Resistências",
		"Board Mount Pressure Sensors":                 "Sensores",
		"Operational Amplifiers - Op Amps":             "Circuitos integrados",
		"ARM Microcontrollers - MCU":                   "Microcontroladores",
		"MOSFETs":                                      "Transístores",
		"TVS Diodes / ESD Suppressors":                 "Díodos",
		"Standard LEDs - SMD":                          "LEDs",
		"LED Lighting Drivers":                         "Circuitos integrados",
		"Crystals":                                     "Cristais e osciladores",
		"Standard Clock Oscillators":                   "Cristais e osciladores",
		"Switching Voltage Regulators":                 "Reguladores de tensão",
		"Switching Controllers":                        "Reguladores de tensão",
		"Pushbutton Switches":                          "Interruptores",
		"Headers & Wire Housings":                      "Conectores",
		"Ferrite Beads":                                "Indutores",
		"Resettable Fuses - PPTC":                      "Fusíveis",
	} {
		g := GroupOf(cat)
		if g == nil || g.Name != want {
			t.Errorf("GroupOf(%q) = %v, want %q", cat, g, want)
		}
	}
	if g := GroupOf("Enclosures for Industrial Automation"); g != nil {
		t.Errorf("GroupOf(enclosures) = %q, want none", g.Name)
	}
}

func TestShortLabel(t *testing.T) {
	for _, tc := range []struct {
		mpn, category, desc, want string
	}{
		{"CL05X105KO5NQWC", "Multilayer Ceramic Capacitors MLCC - SMD/SMT",
			"Multilayer Ceramic Capacitors MLCC - SMD/SMT X6S, 1uF, +/-10%, 16v, 0402", "Capacitors 1uF 0402"},
		{"RC0603FR-0710KL", "Thick Film Resistors - SMD",
			"Thick Film Resistors - SMD General Purpose Chip Resistor 0603, 10kOhms, 1%, 1/10W", "Resistors 10k 0603"},
		{"ERJ-3GEY0R00V", "Thick Film Resistors - SMD", "Thick Film Resistors - SMD 0603 0Ohms Jumper", "Resistors 0R 0603"},
		{"GRM188R71H104KA93D", "Multilayer Ceramic Capacitors MLCC - SMD/SMT",
			"Multilayer Ceramic Capacitors MLCC - SMD/SMT RECOMMENDED ALT 81-GRM188R72A104KA35", "GRM188R71H104KA93D"},
		{"LQM21PN100MC0D", "Fixed Inductors", "Fixed Inductors 10uH 20% 0805", "Inductors 10uH 0805"},
		{"150060RS75000", "Standard LEDs - SMD", "Standard LEDs - SMD WL-SMCW SMD Mono-color Chip LED Red 0603", "LED Red 0603"},
		{"STM32F405RGT6", "ARM Microcontrollers - MCU", "ARM Microcontrollers - MCU ARM M4 1024 FLASH 168 Mhz 192kB SRAM", "STM32F405RGT6"},
		{"BSS138", "MOSFETs", "MOSFETs SOT-23 N-CH LOGIC", "BSS138"},
	} {
		p := Part{MPN: tc.mpn, Description: tc.desc, Category: tc.category}
		p.Package = Footprint(p.MPN, p.Description)
		if got := ShortLabel(p, GroupOf(tc.category)); got != tc.want {
			t.Errorf("ShortLabel(%s) = %q, want %q", tc.mpn, got, tc.want)
		}
	}
}
