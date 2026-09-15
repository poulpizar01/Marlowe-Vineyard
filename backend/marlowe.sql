/*M!999999\- enable the sandbox mode */ 
-- MariaDB dump 10.19  Distrib 10.11.19-MariaDB, for debian-linux-gnu (x86_64)
--
-- Host: localhost    Database: marlowe
-- ------------------------------------------------------
-- Server version	10.11.19-MariaDB-ubu2204

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `images`
--

DROP TABLE IF EXISTS `images`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `images` (
  `cle` varchar(64) NOT NULL,
  `type` varchar(100) NOT NULL,
  `taille` int(10) unsigned NOT NULL,
  `data` longblob NOT NULL,
  `cree` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`cle`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `images`
--

LOCK TABLES `images` WRITE;
/*!40000 ALTER TABLE `images` DISABLE KEYS */;
/*!40000 ALTER TABLE `images` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `kv`
--

DROP TABLE IF EXISTS `kv`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `kv` (
  `cle` varchar(191) NOT NULL,
  `val` longtext NOT NULL,
  `exp` bigint(20) DEFAULT NULL,
  PRIMARY KEY (`cle`),
  KEY `kv_exp` (`exp`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `kv`
--

LOCK TABLES `kv` WRITE;
/*!40000 ALTER TABLE `kv` DISABLE KEYS */;
INSERT INTO `kv` VALUES
('data','{\"comRunner\":[{\"id\":\"Dmtxw8m17\",\"auteur\":\"Erwan Valmora\",\"par\":\"356404251905228802\",\"texte\":\"Disponible pour les bouteilles et les avantages\",\"quand\":\"12/09 06:37\",\"type\":\"dispo\"}]}',NULL),
('datameta','{\"rev\":1,\"by\":\"Erwan Valmora\",\"at\":\"2026-09-12T04:37:12.860Z\",\"keys\":[\"comRunner\"]}',NULL),
('journal','[{\"at\":\"2026-09-12T04:37:12.862Z\",\"by\":\"Erwan Valmora\",\"id\":\"356404251905228802\",\"texte\":\"s\'est annoncé disponible\",\"keys\":[\"comRunner\"]}]',NULL),
('logs:apres','1549430013726564395',NULL),
('settings','{\"visibleRoles\":[\"👑・Patron\",\"👑・Co Patron\",\"⚜️ ▬▬▬▬▬  Responsable  ▬▬▬▬▬ ⚜️\",\"⚜️・DRH\",\"🎉・responsable événementiel\",\"🤝・Responsable Commercial\",\"👑・Directeur Des Responsables-Runners\",\"🚛・Responsable Runner\",\"🛒・Responsable Magasin\",\"📞・Responsable Communication\",\"🛒・Assistant(e) magasin\",\"🤝・Commercial\",\"🛒・Vendeur\",\"🍾・Chef de Culture\",\"🍷・Ouvrier Viticole\",\"🍇・Saisonnier\"],\"dispoRoles\":[\"👑・Patron\",\"👑・Co Patron\",\"⚜️・DRH\",\"🤝・Responsable Commercial\",\"👑・Directeur Des Responsables-Runners\",\"🚛・Responsable Runner\",\"🛒・Responsable Magasin\",\"📞・Responsable Communication\",\"🛒・Assistant(e) magasin\"]}',NULL);
/*!40000 ALTER TABLE `kv` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `ventes`
--

DROP TABLE IF EXISTS `ventes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `ventes` (
  `msg` varchar(32) NOT NULL,
  `ts` bigint(20) NOT NULL,
  `nom` varchar(255) NOT NULL,
  `cle` varchar(255) NOT NULL,
  `qte` int(11) NOT NULL,
  `brut` int(11) NOT NULL,
  `part` int(11) NOT NULL,
  `item` varchar(100) DEFAULT NULL,
  `job` varchar(100) DEFAULT NULL,
  PRIMARY KEY (`msg`),
  KEY `ventes_ts` (`ts`),
  KEY `ventes_cle` (`cle`,`ts`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `ventes`
--

LOCK TABLES `ventes` WRITE;
/*!40000 ALTER TABLE `ventes` DISABLE KEYS */;
INSERT INTO `ventes` VALUES
('1546296913295319132',1788736312937,'Morgan Bilel','morgan bilel',660,6600,3300,'wine','Vigneron'),
('1546301190877225035',1788737332792,'Morgan Bilel','morgan bilel',1201,12010,6005,'wine','Vigneron'),
('1546308492049256539',1788739073527,'Morgan Bilel','morgan bilel',1861,18610,9305,'wine','Vigneron'),
('1546341215296032830',1788746875357,'Jhon Maclain','jhon maclain',891,8910,4455,'wine','Vigneron'),
('1546431045044277270',1788768292438,'Edgar Bachard','edgar bachard',1882,18820,9410,'wine','Vigneron'),
('1546438339534786583',1788770031580,'Edgar Bachard','edgar bachard',1525,15250,7625,'wine','Vigneron'),
('1546438843539128354',1788770151744,'Edgar Bachard','edgar bachard',93,930,465,'wine','Vigneron'),
('1546446154827567155',1788771894891,'Edgar Bachard','edgar bachard',1887,18870,9435,'wine','Vigneron'),
('1546453701512921159',1788773694161,'Edgar Bachard','edgar bachard',1888,18880,9440,'wine','Vigneron'),
('1546461259975888899',1788775496239,'Edgar Bachard','edgar bachard',1891,18910,9455,'wine','Vigneron'),
('1546465022308384809',1788776393249,'Edgar Bachard','edgar bachard',394,3940,1970,'wine','Vigneron'),
('1546469559114924104',1788777474908,'Edgar Bachard','edgar bachard',1499,14990,7495,'wine','Vigneron'),
('1546475597314920493',1788778914527,'Edgar Bachard','edgar bachard',1433,14330,7165,'wine','Vigneron'),
('1546476121292415058',1788779039453,'Jhon Maclain','jhon maclain',698,6980,3490,'wine','Vigneron'),
('1546481392102277131',1788780296112,'James Carter','james carter',264,2640,1320,'grapeJuice','Vigneron'),
('1546537795596714056',1788793743753,'Jade Neuville','jade neuville',1869,18690,9345,'wine','Vigneron'),
('1546547816514584718',1788796132926,'Celia Flynn','celia flynn',1600,16000,8000,'wine','Vigneron'),
('1546554124433367102',1788797636851,'Celia Flynn','celia flynn',1600,16000,8000,'wine','Vigneron'),
('1546560667622838399',1788799196869,'Celia Flynn','celia flynn',1600,16000,8000,'wine','Vigneron'),
('1546578805068402791',1788803521173,'Edgar Bachard','edgar bachard',1880,18800,9400,'wine','Vigneron'),
('1546585843983192075',1788805199381,'Edgar Bachard','edgar bachard',1569,15690,7845,'wine','Vigneron'),
('1546590130071146677',1788806221264,'Morgan Bilel','morgan bilel',1629,16290,8145,'wine','Vigneron'),
('1546596901699326044',1788807835746,'Morgan Bilel','morgan bilel',1620,16200,8100,'wine','Vigneron'),
('1546603704994635777',1788809457778,'Morgan Bilel','morgan bilel',1628,16280,8140,'wine','Vigneron'),
('1546609751465656361',1788810899369,'Miles Maclain','miles maclain',388,3880,1940,'wine','Vigneron'),
('1546610489709043867',1788811075380,'Morgan Bilel','morgan bilel',1623,16230,8115,'wine','Vigneron'),
('1546615532596240445',1788812277698,'Mike Evans','mike evans',935,9350,4675,'wine','Vigneron'),
('1546628608305401908',1788815395190,'Sett Deeton','sett deeton',1101,11010,5505,'wine','Vigneron'),
('1546641431777775647',1788818452544,'Morgan Bilel','morgan bilel',1627,16270,8135,'wine','Vigneron'),
('1546897574412288105',1788879521707,'Bertrand Fontaine','bertrand fontaine',1617,16170,8085,'wine','Vigneron'),
('1546923503293435997',1788885703634,'Jade Neuville','jade neuville',1862,18620,9310,'wine','Vigneron'),
('1546929294478147677',1788887084360,'Bertrand Fontaine','bertrand fontaine',1594,15940,7970,'wine','Vigneron'),
('1546944902586433720',1788890805623,'Rafael Demendes','rafael demendes',1628,16280,8140,'wine','Vigneron'),
('1546949425669214229',1788891884010,'Rafael Demendes','rafael demendes',554,5540,2770,'wine','Vigneron'),
('1546955486438490165',1788893329010,'Rafael Demendes','rafael demendes',377,3770,1885,'wine','Vigneron'),
('1546961782365622353',1788894830076,'Rafael Demendes','rafael demendes',697,6970,3485,'wine','Vigneron'),
('1546962752206143672',1788895061304,'Néo Cooper','neo cooper',1050,10500,5250,'wine','Vigneron'),
('1546963502868992131',1788895240276,'Pablo Pescobarre','pablo pescobarre',675,6750,3375,'wine','Vigneron'),
('1546964266731446474',1788895422395,'Edgar Bachard','edgar bachard',754,7540,3770,'wine','Vigneron'),
('1546964760845750304',1788895540201,'Néo Cooper','neo cooper',549,5490,2745,'wine','Vigneron'),
('1546965043529125949',1788895607598,'Celia Flynn','celia flynn',1692,16920,8460,'wine','Vigneron'),
('1546966081363779607',1788895855037,'Edgar Bachard','edgar bachard',382,3820,1910,'wine','Vigneron'),
('1546968050425925643',1788896324498,'Edgar Bachard','edgar bachard',382,3820,1910,'wine','Vigneron'),
('1546969282863308944',1788896618334,'Edgar Bachard','edgar bachard',354,3540,1770,'wine','Vigneron'),
('1546973604682530960',1788897648736,'Celia Flynn','celia flynn',1610,16100,8050,'wine','Vigneron'),
('1546981871882076191',1788899619790,'James Carter','james carter',1576,15760,7880,'wine','Vigneron'),
('1546996981052739625',1788903222097,'Edgar Bachard','edgar bachard',1398,5720,6990,'wine','Vigneron'),
('1546998475898749019',1788903578496,'Ian Portier','ian portier',1339,13390,6695,'wine','Vigneron'),
('1547000516024991797',1788904064900,'Ian Portier','ian portier',540,5400,2700,'wine','Vigneron'),
('1547008291677278292',1788905918760,'Ian Portier','ian portier',989,9890,4945,'wine','Vigneron'),
('1547008802954543195',1788906040658,'Bertrand Fontaine','bertrand fontaine',1611,16110,8055,'wine','Vigneron'),
('1547010312417316885',1788906400542,'Ian Portier','ian portier',510,5100,2550,'wine','Vigneron'),
('1547017089414594632',1788908016304,'Bertrand Fontaine','bertrand fontaine',1611,16110,8055,'wine','Vigneron'),
('1547018108030558300',1788908259161,'Ian Portier','ian portier',1885,18850,9425,'wine','Vigneron'),
('1547020865814929489',1788908916668,'Bertrand Fontaine','bertrand fontaine',362,3620,1810,'wine','Vigneron'),
('1547026657708220439',1788910297563,'Bertrand Fontaine','bertrand fontaine',871,8710,4355,'wine','Vigneron'),
('1547028159747194961',1788910655677,'Bertrand Fontaine','bertrand fontaine',377,3770,1885,'wine','Vigneron'),
('1547028423082377270',1788910718461,'Bertrand Fontaine','bertrand fontaine',1,10,5,'wine','Vigneron'),
('1547035703526031391',1788912454254,'Bertrand Fontaine','bertrand fontaine',1610,16100,8050,'wine','Vigneron'),
('1547110937335435286',1788930391392,'Antonio Alves','antonio alves',521,5210,2605,'wine','Vigneron'),
('1547192720500465728',1788949890018,'Jhon Maclain','jhon maclain',641,6410,3205,'wine','Vigneron'),
('1547197762892861522',1788951092218,'Morgan Bilel','morgan bilel',1635,16350,8175,'wine','Vigneron'),
('1547216644659609671',1788955593982,'Morgan Bilel','morgan bilel',1630,16300,8150,'wine','Vigneron'),
('1547235523909783615',1788960095146,'Morgan Bilel','morgan bilel',1637,16370,8185,'wine','Vigneron'),
('1547241298858352651',1788961472001,'Morgan Bilel','morgan bilel',1639,16390,8195,'wine','Vigneron'),
('1547266426996400302',1788967463016,'Antonio Alves','antonio alves',1473,14730,7365,'wine','Vigneron'),
('1547268473548181546',1788967950952,'Klewi Mkarkach','klewi mkarkach',1613,16130,8065,'wine','Vigneron'),
('1547274000282165439',1788969268628,'Klewi Mkarkach','klewi mkarkach',363,3630,1815,'wine','Vigneron'),
('1547275223743860808',1788969560324,'Klewi Mkarkach','klewi mkarkach',363,3630,1815,'wine','Vigneron'),
('1547277744537342094',1788970161328,'Klewi Mkarkach','klewi mkarkach',726,7260,3630,'wine','Vigneron'),
('1547278753917440131',1788970401983,'Klewi Mkarkach','klewi mkarkach',160,1600,800,'wine','Vigneron'),
('1547291088040108154',1788973342667,'Ramiro Salazar','ramiro salazar',611,6110,3055,'wine','Vigneron'),
('1547303168566755399',1788976222889,'Ian Portier','ian portier',780,7800,3900,'wine','Vigneron'),
('1547307944691896362',1788977361606,'Ian Portier','ian portier',1110,11100,5550,'wine','Vigneron'),
('1547309959891394571',1788977842067,'Jade Neuville','jade neuville',1863,18630,9315,'wine','Vigneron'),
('1547310701440139396',1788978018866,'Néo Cooper','neo cooper',1595,15950,7975,'wine','Vigneron'),
('1547324070272573501',1788981206244,'James Carter','james carter',1562,15620,7810,'wine','Vigneron'),
('1547324587652423691',1788981329597,'Morgan Bilel','morgan bilel',1627,16270,8135,'wine','Vigneron'),
('1547325319768318003',1788981504147,'Néo Cooper','neo cooper',1595,15950,7975,'wine','Vigneron'),
('1547326083312123926',1788981686190,'Ramiro Salazar','ramiro salazar',778,7780,3890,'wine','Vigneron'),
('1547332134975311955',1788983129019,'Néo Cooper','neo cooper',1596,15960,7980,'wine','Vigneron'),
('1547334856420368486',1788983777862,'Morgan Wyatt','morgan wyatt',1571,15710,7855,'wine','Vigneron'),
('1547339401569247304',1788984861510,'Néo Cooper','neo cooper',1596,15960,7980,'wine','Vigneron'),
('1547341177152471143',1788985284842,'Morgan Bilel','morgan bilel',276,2760,1380,'wine','Vigneron'),
('1547344199157022811',1788986005344,'Morgan Wyatt','morgan wyatt',1578,15780,7890,'wine','Vigneron'),
('1547346172363014226',1788986475793,'Néo Cooper','neo cooper',1597,15970,7985,'wine','Vigneron'),
('1547372084806819931',1788992653801,'Jhon Maclain','jhon maclain',224,2240,1120,'wine','Vigneron'),
('1547373367987011665',1788992959735,'Jhon Maclain','jhon maclain',224,2240,1120,'wine','Vigneron'),
('1547375111269650443',1788993375366,'Jhon Maclain','jhon maclain',372,3720,1860,'wine','Vigneron'),
('1547556783915012159',1789036689500,'Jhon Maclain','jhon maclain',662,6620,3310,'wine','Vigneron'),
('1547560056545878042',1789037469756,'Ian Portier','ian portier',1804,18040,9020,'wine','Vigneron'),
('1547560566418055179',1789037591319,'Ian Portier','ian portier',74,740,370,'wine','Vigneron'),
('1547597313868955723',1789046352594,'Ramiro Salazar','ramiro salazar',892,8920,4460,'wine','Vigneron'),
('1547619447341060119',1789051629625,'Murphy Gonzalez','murphy gonzalez',1726,17260,8630,'wine','Vigneron'),
('1547631014170595470',1789054387372,'Ramiro Salazar','ramiro salazar',786,7860,3930,'wine','Vigneron'),
('1547633053298331750',1789054873538,'Miles Maclain','miles maclain',732,7320,3660,'wine','Vigneron'),
('1547635027464954009',1789055344216,'Zakari Hustler','zakari hustler',154,1540,770,'grapeJuice','Vigneron'),
('1547642069139464203',1789057023082,'Bertrand Fontaine','bertrand fontaine',1629,16290,8145,'wine','Vigneron'),
('1547649370223280172',1789058763796,'Bertrand Fontaine','bertrand fontaine',1604,16040,8020,'wine','Vigneron'),
('1547658682869883075',1789060984104,'Bertrand Fontaine','bertrand fontaine',1603,16030,8015,'wine','Vigneron'),
('1547667771179933710',1789063150926,'Morgan Wyatt','morgan wyatt',1539,15390,7695,'wine','Vigneron'),
('1547668756396904611',1789063385820,'Zakari Hustler','zakari hustler',504,5040,2520,'wine','Vigneron'),
('1547678339463127092',1789065670601,'Lachlan Hawthorne','lachlan hawthorne',1088,10880,5440,'wine','Vigneron'),
('1547684882900062340',1789067230678,'Celia Flynn','celia flynn',417,4170,2085,'wine','Vigneron'),
('1547685668552052842',1789067417992,'Celia Flynn','celia flynn',216,2160,1080,'wine','Vigneron'),
('1547687671969747108',1789067895644,'Celia Flynn','celia flynn',353,3530,1765,'wine','Vigneron'),
('1547689714163781765',1789068382541,'Celia Flynn','celia flynn',613,6130,3065,'wine','Vigneron'),
('1547709052019015752',1789072993045,'Ian Portier','ian portier',380,3800,1900,'wine','Vigneron'),
('1547712053345648684',1789073708617,'Ian Portier','ian portier',497,4970,2485,'wine','Vigneron'),
('1547712802263797911',1789073887173,'Celia Flynn','celia flynn',1598,15980,7990,'wine','Vigneron'),
('1547715817502937119',1789074606062,'Ian Portier','ian portier',999,9990,4995,'wine','Vigneron'),
('1547720097731182623',1789075626548,'Ernesto Demendes','ernesto demendes',2479,24790,12395,'wine','Vigneron'),
('1547725131789639691',1789076826761,'Alex Lozano','alex lozano',1603,16030,8015,'wine','Vigneron'),
('1547730206914125967',1789078036765,'Nueve Style','nueve style',1576,15760,7880,'wine','Vigneron'),
('1547731703806697485',1789078393652,'Bertrand Fontaine','bertrand fontaine',1624,16240,8120,'wine','Vigneron'),
('1547738716146114563',1789080065524,'Bertrand Fontaine','bertrand fontaine',1623,16230,8115,'wine','Vigneron'),
('1547999983809077370',1789142356589,'Murphy Gonzalez','murphy gonzalez',1411,14110,7055,'wine','Vigneron'),
('1548004211558449244',1789143364563,'Bertrand Fontaine','bertrand fontaine',1619,16190,8095,'wine','Vigneron'),
('1548013774575767637',1789145644564,'Morgan Wyatt','morgan wyatt',1186,11860,5930,'wine','Vigneron'),
('1548033923177779212',1789150448365,'Francisca Hollow','francisca hollow',1577,15770,7885,'wine','Vigneron'),
('1548037200619376682',1789151229768,'Francisca Hollow','francisca hollow',319,3190,1595,'wine','Vigneron'),
('1548037440067997800',1789151286857,'Jhon Maclain','jhon maclain',280,2800,1400,'wine','Vigneron'),
('1548037688555344003',1789151346101,'Miles Maclain','miles maclain',342,3420,1710,'wine','Vigneron'),
('1548040443361497170',1789152002898,'Alonzo Trivoli','alonzo trivoli',1903,19030,9515,'wine','Vigneron'),
('1548041223606902875',1789152188923,'Francisca Hollow','francisca hollow',1249,12490,6245,'wine','Vigneron'),
('1548046022369087549',1789153333037,'Lachlan Hawthorne','lachlan hawthorne',147,1470,735,'wine','Vigneron'),
('1548046534552199200',1789153455151,'Francisca Hollow','francisca hollow',426,4260,2130,'wine','Vigneron'),
('1548048797811351616',1789153994754,'Lachlan Hawthorne','lachlan hawthorne',832,8320,4160,'wine','Vigneron'),
('1548050065015439521',1789154296879,'Alonzo Trivoli','alonzo trivoli',1907,19070,9535,'wine','Vigneron'),
('1548058104607019059',1789156213667,'Alonzo Trivoli','alonzo trivoli',1907,19070,9535,'wine','Vigneron'),
('1548061586151706655',1789157043732,'Alonzo Trivoli','alonzo trivoli',407,4070,2035,'wine','Vigneron'),
('1548067368641630280',1789158422385,'Alonzo Trivoli','alonzo trivoli',1500,15000,7500,'wine','Vigneron'),
('1548077709593284689',1789160887860,'Bertrand Fontaine','bertrand fontaine',677,6770,3385,'wine','Vigneron'),
('1548081738566340723',1789161848442,'Bertrand Fontaine','bertrand fontaine',934,9340,4670,'wine','Vigneron'),
('1548090041555882076',1789163828029,'Bertrand Fontaine','bertrand fontaine',1611,16110,8055,'wine','Vigneron'),
('1548099585916796959',1789166103582,'Néo Cooper','neo cooper',1621,16210,8105,'wine','Vigneron'),
('1548101605872631839',1789166585177,'Miles Maclain','miles maclain',727,7270,3635,'wine','Vigneron'),
('1548106615213916223',1789167779497,'Néo Cooper','neo cooper',1635,16350,8175,'wine','Vigneron'),
('1548111655945244807',1789168981301,'Wesley Smhtis','wesley smhtis',767,7670,3835,'wine','Vigneron'),
('1548113926733172737',1789169522699,'Néo Cooper','neo cooper',1638,16380,8190,'wine','Vigneron'),
('1548114676993490975',1789169701575,'Ian Portier','ian portier',1882,18820,9410,'wine','Vigneron'),
('1548115428574896159',1789169880766,'Wesley Smhtis','wesley smhtis',865,8650,4325,'wine','Vigneron'),
('1548121735977504879',1789171384568,'Néo Cooper','neo cooper',1638,16380,8190,'wine','Vigneron'),
('1548127022474334270',1789172644967,'Ian Portier','ian portier',1627,16270,8135,'wine','Vigneron'),
('1548128508302200907',1789172999216,'Néo Cooper','neo cooper',1636,16360,8180,'wine','Vigneron'),
('1548134316545147031',1789174384009,'Ian Portier','ian portier',1631,16310,8155,'wine','Vigneron'),
('1548278748514877531',1789208819274,'Crazy Doe','crazy doe',555,5550,2775,'wine','Vigneron'),
('1548324574549254266',1789219745052,'Jhon Maclain','jhon maclain',650,6500,3250,'wine','Vigneron'),
('1548326582798651415',1789220223856,'Kairo Gavilla','kairo gavilla',309,3090,1545,'wine','Vigneron'),
('1548331115943829568',1789221304642,'Kairo Gavilla','kairo gavilla',1249,12490,6245,'wine','Vigneron'),
('1548345023265906720',1789224620406,'Bertrand Fontaine','bertrand fontaine',1604,14220,8020,'wine','Vigneron'),
('1548357350392336455',1789227559422,'Jade Neuville','jade neuville',1874,18740,9370,'wine','Vigneron'),
('1548362861011796100',1789228873256,'Jade Neuville','jade neuville',745,7450,3725,'wine','Vigneron'),
('1548363879224975462',1789229116017,'James Carter','james carter',1347,13470,6735,'wine','Vigneron'),
('1548365167476084837',1789229423160,'James Carter','james carter',233,2330,1165,'wine','Vigneron'),
('1548366422307115181',1789229722335,'Néo Cooper','neo cooper',371,3710,1855,'wine','Vigneron'),
('1548371171769196635',1789230854695,'Néo Cooper','neo cooper',1249,12490,6245,'wine','Vigneron'),
('1548373187597836352',1789231335306,'Bertrand Fontaine','bertrand fontaine',818,0,4090,'wine','Vigneron'),
('1548386034881138891',1789234398337,'Kairo Gavilla','kairo gavilla',1197,11970,5985,'wine','Vigneron'),
('1548403923302355025',1789238663269,'Lachlan Hawthorne','lachlan hawthorne',1377,13770,6885,'wine','Vigneron'),
('1548416961669636137',1789241771858,'Ian Portier','ian portier',1866,18660,9330,'wine','Vigneron'),
('1548470560600891485',1789254550839,'Alex Lozano','alex lozano',1605,16050,8025,'wine','Vigneron'),
('1548476856729075733',1789256051953,'Alex Lozano','alex lozano',901,9010,4505,'wine','Vigneron'),
('1548492458768212099',1789259771769,'Celia Flynn','celia flynn',504,5040,2520,'wine','Vigneron'),
('1548494198532083813',1789260186561,'Celia Flynn','celia flynn',393,3930,1965,'wine','Vigneron'),
('1548494709930852483',1789260308488,'Ian Portier','ian portier',1296,12960,6480,'wine','Vigneron'),
('1548495957627506729',1789260605962,'Nueve Style','nueve style',1577,15770,7885,'wine','Vigneron'),
('1548496973685063703',1789260848209,'Ian Portier','ian portier',566,5660,2830,'wine','Vigneron'),
('1548505510842474568',1789262883626,'Nueve Style','nueve style',1346,13460,6730,'wine','Vigneron'),
('1548599635134910565',1789285324606,'Néo Cooper','neo cooper',1621,16210,8105,'wine','Vigneron'),
('1548618772779241553',1789289887376,'Néo Cooper','neo cooper',1427,14270,7135,'wine','Vigneron'),
('1548653515797172235',1789298170757,'Celia Flynn','celia flynn',352,3520,1760,'wine','Vigneron'),
('1548661053603192954',1789299967910,'Jimbo Maclain','jimbo maclain',1589,15890,7945,'wine','Vigneron'),
('1548663839321493555',1789300632077,'Celia Flynn','celia flynn',3116,31160,15580,'wine','Vigneron'),
('1548665847403388992',1789301110841,'Sapo Makolo','sapo makolo',323,3230,1615,'wine','Vigneron'),
('1548669375286870018',1789301951954,'Sapo Makolo','sapo makolo',323,3230,1615,'wine','Vigneron'),
('1548670147022028931',1789302135950,'Sapo Makolo','sapo makolo',195,1950,975,'wine','Vigneron'),
('1548670399200493670',1789302196074,'Celia Flynn','celia flynn',1605,16050,8025,'wine','Vigneron'),
('1548675410223431731',1789303390795,'Jimbo Maclain','jimbo maclain',918,9180,4590,'wine','Vigneron'),
('1548676949877071974',1789303757877,'Celia Flynn','celia flynn',1361,13610,6805,'wine','Vigneron'),
('1548678449487552523',1789304115412,'Jimbo Maclain','jimbo maclain',678,6780,3390,'wine','Vigneron'),
('1548685736327249921',1789305852730,'Jimbo Maclain','jimbo maclain',365,3650,1825,'wine','Vigneron'),
('1548708708169682949',1789311329644,'James Carter','james carter',1587,15870,7935,'wine','Vigneron'),
('1548709220097200270',1789311451697,'Nueve Style','nueve style',592,5920,2960,'wine','Vigneron'),
('1548713994578301061',1789312590022,'James Carter','james carter',778,7780,3890,'wine','Vigneron'),
('1548727333836300421',1789315770349,'Jimbo Maclain','jimbo maclain',345,3450,1725,'wine','Vigneron'),
('1548732619020308611',1789317030435,'Tyler Knox','tyler knox',605,6050,3025,'wine','Vigneron'),
('1548734621938618641',1789317507968,'Wesley Smhtis','wesley smhtis',585,5850,2925,'wine','Vigneron'),
('1548734875933216869',1789317568525,'Lachlan Hawthorne','lachlan hawthorne',1496,14960,7480,'wine','Vigneron'),
('1548735905215545356',1789317813925,'Jhon Maclain','jhon maclain',504,5040,2520,'wine','Vigneron'),
('1548737940140859433',1789318299089,'Wesley Smhtis','wesley smhtis',1042,10420,5210,'wine','Vigneron'),
('1548742705461596221',1789319435230,'Wesley Smhtis','wesley smhtis',959,9590,4795,'wine','Vigneron'),
('1548745225491718197',1789320036052,'Wesley Smhtis','wesley smhtis',679,6790,3395,'wine','Vigneron'),
('1548749745697063044',1789321113753,'Wesley Smhtis','wesley smhtis',908,9080,4540,'wine','Vigneron'),
('1548754013518823466',1789322131281,'Wesley Smhtis','wesley smhtis',388,3880,1940,'wine','Vigneron'),
('1548755023763345520',1789322372142,'Rafael Demendes','rafael demendes',1619,16190,8095,'wine','Vigneron'),
('1548757021988364309',1789322848556,'Wesley Smhtis','wesley smhtis',341,3410,1705,'wine','Vigneron'),
('1548759800555503727',1789323511018,'Mike Evans','mike evans',1543,15430,7715,'wine','Vigneron'),
('1548763311804260353',1789324348165,'Wesley Smhtis','wesley smhtis',984,9840,4920,'wine','Vigneron'),
('1548765092051419299',1789324772609,'Rafael Demendes','rafael demendes',1620,16200,8100,'wine','Vigneron'),
('1548766370903097486',1789325077511,'Wesley Smhtis','wesley smhtis',655,6550,3275,'wine','Vigneron'),
('1548772386386747425',1789326511714,'Rafael Demendes','rafael demendes',1620,16200,8100,'wine','Vigneron'),
('1548816403123929219',1789337006122,'Alex Lozano','alex lozano',1254,12540,6270,'wine','Vigneron'),
('1548817681308721253',1789337310865,'Alex Lozano','alex lozano',204,2040,1020,'wine','Vigneron'),
('1548843071783837717',1789343364426,'Sett Deeton','sett deeton',1094,10940,5470,'wine','Vigneron'),
('1548861425525457038',1789347740299,'Sett Deeton','sett deeton',591,5910,2955,'wine','Vigneron'),
('1548971158697939027',1789373902726,'Morgan Bilel','morgan bilel',1621,16210,8105,'wine','Vigneron'),
('1548992035938242591',1789378880248,'Morgan Bilel','morgan bilel',1619,16190,8095,'wine','Vigneron'),
('1549013693214359624',1789384043745,'Morgan Bilel','morgan bilel',1624,16240,8120,'wine','Vigneron'),
('1549030550919192668',1789388062935,'Morgan Bilel','morgan bilel',1610,16100,8050,'wine','Vigneron'),
('1549053707382169701',1789393583866,'Zakari Hustler','zakari hustler',764,7640,3820,'wine','Vigneron'),
('1549078674525913090',1789399536497,'Zakari Hustler','zakari hustler',1057,10570,5285,'wine','Vigneron'),
('1549088006730940427',1789401761468,'Mike Evans','mike evans',1485,14850,7425,'wine','Vigneron'),
('1549089486120689825',1789402114182,'Jony Carter','jony carter',1281,12810,6405,'wine','Vigneron'),
('1549092760017965198',1789402894740,'Morgan Bilel','morgan bilel',1625,16250,8125,'wine','Vigneron'),
('1549098572622987336',1789404280573,'James Carter','james carter',1331,13310,6655,'wine','Vigneron'),
('1549126501805330554',1789410939409,'Celia Flynn','celia flynn',1590,15900,7950,'wine','Vigneron'),
('1549126745624551565',1789410997540,'Mike Evans','mike evans',479,4790,2395,'wine','Vigneron'),
('1549132301001040125',1789412322045,'James Carter','james carter',1079,10790,5395,'wine','Vigneron'),
('1549133057146232954',1789412502324,'Celia Flynn','celia flynn',1591,15910,7955,'wine','Vigneron'),
('1549138365272825897',1789413767880,'Jhon Maclain','jhon maclain',635,6350,3175,'wine','Vigneron'),
('1549139342033813595',1789414000758,'Celia Flynn','celia flynn',1591,15910,7955,'wine','Vigneron'),
('1549153952166183063',1789417484085,'Edgar Bachard','edgar bachard',1662,16620,8310,'wine','Vigneron'),
('1549154187290480661',1789417540143,'Tiago Torez','tiago torez',103,1030,515,'wine','Vigneron'),
('1549156968168558715',1789418203156,'Douglas Kovarci','douglas kovarci',406,4060,2030,'wine','Vigneron'),
('1549164289724518481',1789419948751,'Edgar Bachard','edgar bachard',1833,18330,9165,'wine','Vigneron'),
('1549167785890947134',1789420782302,'Ian Portier','ian portier',1818,18180,9090,'wine','Vigneron'),
('1549173549196120167',1789422156381,'Edgar Bachard','edgar bachard',1832,18320,9160,'wine','Vigneron'),
('1549175799347814542',1789422692859,'Ian Portier','ian portier',1857,18570,9285,'wine','Vigneron'),
('1549183345127071867',1789424491913,'Edgar Bachard','edgar bachard',1831,18310,9155,'wine','Vigneron'),
('1549188133914935368',1789425633649,'Edgar Bachard','edgar bachard',842,8420,4210,'wine','Vigneron'),
('1549221582876971102',1789433608503,'Bertrand Fontaine','bertrand fontaine',1620,16200,8100,'wine','Vigneron'),
('1549345130740449344',1789463064609,'Morgan Bilel','morgan bilel',1626,16260,8130,'wine','Vigneron'),
('1549347906576846879',1789463726420,'Robert Morgan','robert morgan',1627,16270,8135,'wine','Vigneron'),
('1549354712690855987',1789465349124,'Robert Morgan','robert morgan',1633,16330,8165,'wine','Vigneron'),
('1549361494347620353',1789466965997,'Robert Morgan','robert morgan',1642,16420,8210,'wine','Vigneron'),
('1549371821592154196',1789469428204,'Morgan Bilel','morgan bilel',1601,16010,8005,'wine','Vigneron'),
('1549378385086779495',1789470993063,'Morgan Bilel','morgan bilel',1601,16010,8005,'wine','Vigneron'),
('1549417887545167903',1789480411183,'Isadora Ashour','isadora ashour',606,6060,3030,'wine','Vigneron'),
('1549430013726564395',1789483302290,'Isadora Ashour','isadora ashour',462,4620,2310,'wine','Vigneron');
/*!40000 ALTER TABLE `ventes` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-09-15 15:12:49
