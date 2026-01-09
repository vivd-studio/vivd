import { removeDuplicateContent } from '../src/generator/scraper/deduplication';
import * as assert from 'assert';

console.log('Running Text Deduplication Tests...');

try {
    // Test 1: Exact Match
    {
        console.log('Test 1: Exact Match');
        const baseText = `
Header Line 1
Header Line 2
Header Line 3
Unique Content Main
Footer Line 1
Footer Line 2
Footer Line 3
`.trim();

        const newText = `
Header Line 1
Header Line 2
Header Line 3
Unique Content Subpage
Footer Line 1
Footer Line 2
Footer Line 3
`.trim();

        const expected = `Unique Content Subpage`;

        const result = removeDuplicateContent(baseText, newText);
        assert.strictEqual(result.trim(), expected.trim());
        console.log('PASS');
    }

    // Test 2: Unique Content
    {
        console.log('Test 2: Unique Content');
        const baseText = `Line A\nLine B\nLine C`;
        const newText = `Line D\nLine E\nLine F`;
        const result = removeDuplicateContent(baseText, newText);
        assert.strictEqual(result.trim(), newText.trim());
        console.log('PASS');
    }

    // Test 3: Min Block Lines
    {
        console.log('Test 3: Min Block Lines');
        const baseText = `Line A\nLine B\nLine C`;
        const newText = `Line A\nLine B\nUnique Line`;

        // Default minBlockLines is 3, so A and B should NOT be removed
        const result = removeDuplicateContent(baseText, newText, 3);
        assert.strictEqual(result.trim(), newText.trim());

        // If we set min to 2, they should be removed
        const result2 = removeDuplicateContent(baseText, newText, 2);
        assert.strictEqual(result2.trim(), 'Unique Line');
        console.log('PASS');
    }

    // Test 4: User Example
    {
        console.log('Test 4: User Example');
        const baseText = `
Ulf Bartels Ortho-Team
HOME
Willkommen
KONTAKT
Wir sind für Sie da
TEAM
Die Menschen
PHILOSOPHIE
Aspekt des Heilens
IMPRESSUM
Rechtliche Infos

040 - 601 497 7
040 - 600 333 9
info@ortho-team-bartels.de

ULF BARTELS ORTHO-TEAM

Berner Weg 13 | 22393 Hamburg

Basisleistungen

Zusatzleistungen
Home - Willkommen

Liebe Patientinnen und Patienten,

herzlich willkommen auf der Website unserer Praxis für Orthopädie und Sportmedizin.
Unsere Internetseite soll Ihnen einen ausführlichen Einblick in die von uns angebotenen Leistungen geben.

Denn Gesundheit ist einer der zentralen Punkte Ihres Lebens.
Unser Team unterstützt Sie umfassend darin, Ihre Gesundheit wiederherzustellen und zu erhalten. Hierbei bieten wir Ihnen modernste Untersuchungs- und Behandlungsmethoden, die sich konsequent am heutigen Stand der Wissenschaft und an anerkannten Behandlungsleitlinien orientieren.

Sowohl Kassenpatienten als auch Privatversicherte finden bei uns ganzheitliche Diagnostik und Beratung.
Neben den klassischen orthopädischen Behandlungsmethoden setzen wir einen Schwerpunkt auch auf sanfte Verfahren wie die Akupunktur.
Bei allen Therapieverfahren setzen wir unsere Erfahrungen kompromisslos in den Dienst unserer Patienten.

Wir freuen uns auf Ihren Besuch!

Ihr Ortho-Team
Ulf Bartels

Neuigkeiten

Liebe Patienten,

eine telefonische Anmeldung  zur Allgemeinen- und Privatsprechstunde muss morgens um 8:30 Uhr und nachmittags um 14:30 Uhr erfolgen.

Allgemeine Sprechstunde:
Mo. bis Do. 8:30 Uhr - 12:30 Uhr sowie 14:30 Uhr - 18:00 Uhr.

Privat - und Selbstzahlersprechstunde:
Mi. 8.30 Uhr - 12.30 Uhr sowie am Di. 14:30 Uhr - 18:00 Uhr.

Freitags wird keine Spechstunde angeboten !!!

-------------------------------------------------

Unsere Praxis wurde von dem Magazin 'FOCUS-GESUNDHEIT' als eine empfohlene Praxis 2017 in Hamburg ausgezeichnet !!!
Im Internet unter: www.focus-arztsuche.de zu besuchen.

Sportmedizin

Wir bringen Sie an den Start. Mehr...

Öffnungszeiten

Sprechstunden Kasse:
Mo – Do:

08:30–12:30 Uhr

sowie:
14:30–18:00 Uhr

Sprechstunden Privat- und Selbstzahler:

Di:
14:30–18:00 Uhr

Mi:
08:30–12:30 Uhr

Datenschutz

Wir möchten Sie darüber informieren, dass beim Besuch unserer Homepage personenbezogene Daten erhoben werden. Weitere Infos finden Sie in unserer Datenschutzerklärung.
`;

        const subpageText = `
Ulf Bartels Ortho-Team
HOME
Willkommen
KONTAKT
Wir sind für Sie da
TEAM
Die Menschen
PHILOSOPHIE
Aspekt des Heilens
IMPRESSUM
Rechtliche Infos

040 - 601 497 7
040 - 600 333 9
info@ortho-team-bartels.de

ULF BARTELS ORTHO-TEAM

Berner Weg 13 | 22393 Hamburg

Basisleistungen

Zusatzleistungen
Kontakt - Wir sind für Sie da
So finden Sie zu uns:

Ulf Bartels Ortho-Team

Berner Weg 13, 22393 Hamburg

Telefon:
040 - 601 49 77

Fax:
040 - 600 33 39

E-Mail:
info@ortho-team-bartels.de
Verkehrsverbindung: Metrobus 24, Haltestelle “Saseler Markt”

Neuigkeiten

Liebe Patienten,

eine telefonische Anmeldung  zur Allgemeinen- und Privatsprechstunde muss morgens um 8:30 Uhr und nachmittags um 14:30 Uhr erfolgen.

Allgemeine Sprechstunde:
Mo. bis Do. 8:30 Uhr - 12:30 Uhr sowie 14:30 Uhr - 18:00 Uhr.

Privat - und Selbstzahlersprechstunde:
Mi. 8.30 Uhr - 12.30 Uhr sowie am Di. 14:30 Uhr - 18:00 Uhr.

Freitags wird keine Spechstunde angeboten !!!

-------------------------------------------------

Unsere Praxis wurde von dem Magazin 'FOCUS-GESUNDHEIT' als eine empfohlene Praxis 2017 in Hamburg ausgezeichnet !!!
Im Internet unter: www.focus-arztsuche.de zu besuchen.

Sportmedizin

Wir bringen Sie an den Start. Mehr...

Öffnungszeiten

Sprechstunden Kasse:
Mo – Do:

08:30–12:30 Uhr

sowie:
14:30–18:00 Uhr

Sprechstunden Privat- und Selbstzahler:

Di:
14:30–18:00 Uhr

Mi:
08:30–12:30 Uhr

Datenschutz

Wir möchten Sie darüber informieren, dass beim Besuch unserer Homepage personenbezogene Daten erhoben werden. Weitere Infos finden Sie in unserer Datenschutzerklärung.
`;

        const result = removeDuplicateContent(baseText, subpageText);



        // Assertions
        // Assertions
        // The header sequence should be removed
        assert.ok(!result.includes('Ulf Bartels Ortho-Team\nHOME'), 'Header sequence should be removed');
        assert.ok(!result.includes('HOME'), 'Menu should be removed');
        assert.ok(!result.includes('Neuigkeiten'), 'Footer/Sidebar should be removed');
        assert.ok(!result.includes('Öffnungszeiten'), 'Opening hours should be removed');

        assert.ok(result.includes('Kontakt - Wir sind für Sie da'), 'Unique title should remain');
        assert.ok(result.includes('So finden Sie zu uns:'), 'Unique content should remain');

        console.log('PASS');
    }

    console.log('All tests passed!');

} catch (error) {
    console.error('Test Failed:', error);
    process.exit(1);
}
