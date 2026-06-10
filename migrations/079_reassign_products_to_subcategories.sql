-- Riassegna i prodotti di Abbigliamento, Alimentari, Elettronica e Libri alle
-- sottocategorie create in 078, così le pagine sottocategoria non sono più vuote
-- (causa del bug "nessun prodotto in nessuna categoria" quando si apre una
-- sottocategoria). Riassegnazione per nome, stesso pattern di 068/069.
--
-- Idempotente: le UPDATE agiscono solo sui prodotti ancora agganciati al parent
-- di primo livello; gli step sono ordinati dal più specifico. I non riconosciuti
-- restano sul parent e finiscono nella rail "Altri prodotti".

-- ---------------------------- ABBIGLIAMENTO --------------------------------
with parent as (select id from public.categories where slug = 'abbigliamento' and parent_id is null)
update public.products p set category_id = (select id from public.categories where slug = 'abbigliamento-scarpe')
where p.category_id = (select id from parent)
  and (p.name ilike '%scarpe%' or p.name ilike '%sneaker%' or p.name ilike '%stival%'
       or p.name ilike '%decollete%' or p.name ilike '%décolleté%' or p.name ilike '%ballerine%'
       or p.name ilike '%sandal%' or p.name ilike '%mocassin%' or p.name ilike '%anfibi%' or p.name ilike '%infradito%');

with parent as (select id from public.categories where slug = 'abbigliamento' and parent_id is null)
update public.products p set category_id = (select id from public.categories where slug = 'abbigliamento-accessori')
where p.category_id = (select id from parent)
  and (p.name ilike '%borsa%' or p.name ilike '%pochette%' or p.name ilike '%tracolla%'
       or p.name ilike '%zaino%' or p.name ilike '%marsupio%' or p.name ilike '%cintura%'
       or p.name ilike '%cappello%' or p.name ilike '%berretto%' or p.name ilike '%sciarpa%'
       or p.name ilike '%panama%' or p.name ilike '%guanti%' or p.name ilike '%foulard%'
       or p.name ilike '%cravatta%' or p.name ilike '%occhiali%' or p.name ilike '%portafoglio%');

with parent as (select id from public.categories where slug = 'abbigliamento' and parent_id is null)
update public.products p set category_id = (select id from public.categories where slug = 'abbigliamento-intimo')
where p.category_id = (select id from parent)
  and (p.name ilike '%boxer%' or p.name ilike '%slip%' or p.name ilike '%intimo%'
       or p.name ilike '%calzini%' or p.name ilike '%calze%' or p.name ilike '%reggiseno%'
       or p.name ilike '%pigiama%' or p.name ilike '%mutande%');

with parent as (select id from public.categories where slug = 'abbigliamento' and parent_id is null)
update public.products p set category_id = (select id from public.categories where slug = 'abbigliamento-capispalla')
where p.category_id = (select id from parent)
  and (p.name ilike '%giacca%' or p.name ilike '%giubbino%' or p.name ilike '%giubbotto%'
       or p.name ilike '%cappotto%' or p.name ilike '%blazer%' or p.name ilike '%piumino%'
       or p.name ilike '%parka%' or p.name ilike '%trench%' or p.name ilike '%bomber%');

with parent as (select id from public.categories where slug = 'abbigliamento' and parent_id is null)
update public.products p set category_id = (select id from public.categories where slug = 'abbigliamento-magliette')
where p.category_id = (select id from parent)
  and (p.name ilike '%t-shirt%' or p.name ilike '%tshirt%' or p.name ilike '%camicia%'
       or p.name ilike '%camicett%' or p.name ilike '%polo%' or p.name ilike '%canotta%' or p.name ilike '%top %');

with parent as (select id from public.categories where slug = 'abbigliamento' and parent_id is null)
update public.products p set category_id = (select id from public.categories where slug = 'abbigliamento-maglieria')
where p.category_id = (select id from parent)
  and (p.name ilike '%maglione%' or p.name ilike '%cardigan%' or p.name ilike '%felpa%' or p.name ilike '%pullover%');

with parent as (select id from public.categories where slug = 'abbigliamento' and parent_id is null)
update public.products p set category_id = (select id from public.categories where slug = 'abbigliamento-pantaloni')
where p.category_id = (select id from parent)
  and (p.name ilike '%jeans%' or p.name ilike '%pantalon%' or p.name ilike '%chino%'
       or p.name ilike '%bermuda%' or p.name ilike '%short%' or p.name ilike '%leggings%');

with parent as (select id from public.categories where slug = 'abbigliamento' and parent_id is null)
update public.products p set category_id = (select id from public.categories where slug = 'abbigliamento-abiti')
where p.category_id = (select id from parent)
  and (p.name ilike '%vestito%' or p.name ilike '%abito%' or p.name ilike '%gonna%');

-- ------------------------------ ALIMENTARI ---------------------------------
with parent as (select id from public.categories where slug = 'alimentari' and parent_id is null)
update public.products p set category_id = (select id from public.categories where slug = 'salumeria')
where p.category_id = (select id from parent)
  and (p.name ilike '%bresaola%' or p.name ilike '%coppa%' or p.name ilike '%mortadella%'
       or p.name ilike '%pancetta%' or p.name ilike '%prosciutto%' or p.name ilike '%salame%'
       or p.name ilike '%speck%' or p.name ilike '%salumi%' or p.name ilike '%culatello%');

with parent as (select id from public.categories where slug = 'alimentari' and parent_id is null)
update public.products p set category_id = (select id from public.categories where slug = 'alimentari-latticini')
where p.category_id = (select id from parent)
  and (p.name ilike '%gorgonzola%' or p.name ilike '%grana%' or p.name ilike '%pecorino%'
       or p.name ilike '%provolone%' or p.name ilike '%stracchino%' or p.name ilike '%formaggio%'
       or p.name ilike '%mozzarella%' or p.name ilike '%latte%' or p.name ilike '%burro%'
       or p.name ilike '%yogurt%' or p.name ilike '%ricotta%' or p.name ilike '%parmigiano%');

with parent as (select id from public.categories where slug = 'alimentari' and parent_id is null)
update public.products p set category_id = (select id from public.categories where slug = 'alimentari-pasta-fresca')
where p.category_id = (select id from parent)
  and (p.name ilike '%anolini%' or p.name ilike '%tortelli%' or p.name ilike '%ravioli%'
       or p.name ilike '%gnocchi%' or p.name ilike '%pasta fresca%' or p.name ilike '%pisarei%');

with parent as (select id from public.categories where slug = 'alimentari' and parent_id is null)
update public.products p set category_id = (select id from public.categories where slug = 'frutta-verdura')
where p.category_id = (select id from parent)
  and (p.name ilike '%arance%' or p.name ilike '%banane%' or p.name ilike '%carote%'
       or p.name ilike '%cipolle%' or p.name ilike '%fragole%' or p.name ilike '%insalata%'
       or p.name ilike '%limoni%' or p.name ilike '%melanzane%' or p.name ilike '%mele%'
       or p.name ilike '%patate%' or p.name ilike '%peperoni%' or p.name ilike '%pere%'
       or p.name ilike '%pomodor%' or p.name ilike '%uva%' or p.name ilike '%zucchine%'
       or p.name ilike '%verdura%' or p.name ilike '%frutta%' or p.name ilike '%spinaci%');

-- ------------------------------ ELETTRONICA --------------------------------
with parent as (select id from public.categories where slug = 'elettronica' and parent_id is null)
update public.products p set category_id = (select id from public.categories where slug = 'elettronica-audio')
where p.category_id = (select id from parent)
  and (p.name ilike '%cuffie%' or p.name ilike '%auricolari%' or p.name ilike '%speaker%'
       or p.name ilike '%microfono%' or p.name ilike '%airpods%' or p.name ilike '%casse%');

with parent as (select id from public.categories where slug = 'elettronica' and parent_id is null)
update public.products p set category_id = (select id from public.categories where slug = 'elettronica-wearable')
where p.category_id = (select id from parent)
  and (p.name ilike '%smartwatch%' or p.name ilike '%bracciale fitness%' or p.name ilike '%wearable%' or p.name ilike '%fitness tracker%');

with parent as (select id from public.categories where slug = 'elettronica' and parent_id is null)
update public.products p set category_id = (select id from public.categories where slug = 'elettronica-foto')
where p.category_id = (select id from parent)
  and (p.name ilike '%webcam%' or p.name ilike '%selfie%' or p.name ilike '%anello luminoso%'
       or p.name ilike '%treppiede%' or p.name ilike '%fotocamera%' or p.name ilike '%gopro%');

with parent as (select id from public.categories where slug = 'elettronica' and parent_id is null)
update public.products p set category_id = (select id from public.categories where slug = 'elettronica-computer')
where p.category_id = (select id from parent)
  and (p.name ilike '%mouse%' or p.name ilike '%tastiera%' or p.name ilike '%hub usb%'
       or p.name ilike '%ssd%' or p.name ilike '%stand%' or p.name ilike '%laptop%'
       or p.name ilike '%memory card%' or p.name ilike '%microsd%' or p.name ilike '%monitor%');

with parent as (select id from public.categories where slug = 'elettronica' and parent_id is null)
update public.products p set category_id = (select id from public.categories where slug = 'elettronica-accessori')
where p.category_id = (select id from parent)
  and (p.name ilike '%caricabatterie%' or p.name ilike '%caricatore%' or p.name ilike '%cavo%'
       or p.name ilike '%cover%' or p.name ilike '%custodia%' or p.name ilike '%pellicola%'
       or p.name ilike '%powerbank%' or p.name ilike '%adattatore%' or p.name ilike '%supporto%'
       or p.name ilike '%lampada%' or p.name ilike '%pad mouse%');

-- -------------------------------- LIBRI ------------------------------------
with parent as (select id from public.categories where slug = 'libri' and parent_id is null)
update public.products p set category_id = (select id from public.categories where slug = 'libri-cartoleria')
where p.category_id = (select id from parent)
  and (p.name ilike '%agenda%' or p.name ilike '%album da disegno%' or p.name ilike '%astuccio%'
       or p.name ilike '%calcolatrice%' or p.name ilike '%cartelletta%' or p.name ilike '%colla%'
       or p.name ilike '%forbici%' or p.name ilike '%matite%' or p.name ilike '%pastelli%'
       or p.name ilike '%pennarelli%' or p.name ilike '%penne%' or p.name ilike '%quaderni%'
       or p.name ilike '%risma%' or p.name ilike '%righell%' or p.name ilike '%squadre%'
       or p.name ilike '%zaino%' or p.name ilike '%gomma%' or p.name ilike '%evidenziator%'
       or p.name ilike '%raccoglitore%' or p.name ilike '%biro%' or p.name ilike '%cartella%');

with parent as (select id from public.categories where slug = 'libri' and parent_id is null)
update public.products p set category_id = (select id from public.categories where slug = 'libri-crescita-personale')
where p.category_id = (select id from parent)
  and (p.name ilike '%potere%' or p.name ilike '%crescita personale%' or p.name ilike '%leadership%'
       or p.name ilike '%abitudini%' or p.name ilike '%motivazion%' or p.name ilike '%mindset%'
       or p.name ilike '%successo%' or p.name ilike '%self%');

with parent as (select id from public.categories where slug = 'libri' and parent_id is null)
update public.products p set category_id = (select id from public.categories where slug = 'libri-gialli')
where p.category_id = (select id from parent)
  and (p.name ilike '%giallo%' or p.name ilike '%thriller%' or p.name ilike '%camilleri%' or p.name ilike '%noir%');

with parent as (select id from public.categories where slug = 'libri' and parent_id is null)
update public.products p set category_id = (select id from public.categories where slug = 'libri-cucina')
where p.category_id = (select id from parent)
  and (p.name ilike '%cucina%' or p.name ilike '%ricett%' or p.name ilike '%gastronomia%');

with parent as (select id from public.categories where slug = 'libri' and parent_id is null)
update public.products p set category_id = (select id from public.categories where slug = 'libri-arte')
where p.category_id = (select id from parent)
  and (p.name ilike '%arte%' or p.name ilike '%fotografia%' or p.name ilike '%rinascimento%' or p.name ilike '%pittura%');

with parent as (select id from public.categories where slug = 'libri' and parent_id is null)
update public.products p set category_id = (select id from public.categories where slug = 'libri-guide')
where p.category_id = (select id from parent)
  and (p.name ilike '%guida%' or p.name ilike '%atlante%' or p.name ilike '%viaggi%');

with parent as (select id from public.categories where slug = 'libri' and parent_id is null)
update public.products p set category_id = (select id from public.categories where slug = 'libri-storia')
where p.category_id = (select id from parent)
  and (p.name ilike '%storia%' or p.name ilike '%storico%');

with parent as (select id from public.categories where slug = 'libri' and parent_id is null)
update public.products p set category_id = (select id from public.categories where slug = 'libri-scolastici')
where p.category_id = (select id from parent)
  and (p.name ilike '%dizionario%' or p.name ilike '%scolastic%' or p.name ilike '%universit%'
       or p.name ilike '%informatica%' or p.name ilike '%grammatica%');

with parent as (select id from public.categories where slug = 'libri' and parent_id is null)
update public.products p set category_id = (select id from public.categories where slug = 'libri-bambini')
where p.category_id = (select id from parent)
  and (p.name ilike '%bambini%' or p.name ilike '%illustrato%' or p.name ilike '%favole%' or p.name ilike '%fiabe%');

with parent as (select id from public.categories where slug = 'libri' and parent_id is null)
update public.products p set category_id = (select id from public.categories where slug = 'libri-romanzi')
where p.category_id = (select id from parent)
  and (p.name ilike '%romanzo%' or p.name ilike '%promessi sposi%' or p.name ilike '%poesie%'
       or p.name ilike '%montale%' or p.name ilike '%manzoni%' or p.name ilike '%biografia%'
       or p.name ilike '%contemporaneo%');

with parent as (select id from public.categories where slug = 'libri' and parent_id is null)
update public.products p set category_id = (select id from public.categories where slug = 'libri-saggistica')
where p.category_id = (select id from parent)
  and (p.name ilike '%manuale%' or p.name ilike '%saggi%' or p.name ilike '%giardinaggio%');
