// Pages légales en français (décisions §37.4). Rédigées d'après ce que fait le produit aujourd'hui (paiement à la livraison,
// WhatsApp, messages vocaux, « supprimer mes données », loi 81/2018). C'est la version pilote : l'avocat la relit avant le lancement.
import type { LegalCopy } from "./legal.en";

export const legalFr: LegalCopy = {
  updatedOn: "2026-10-13",
  draftNote:
    "Version pilote. Alo King SARL est en cours de constitution ; ces pages seront mises à jour, et re-datées, une fois la société enregistrée et relues par notre avocat.",
  entityHeading: "Qui sommes-nous",
  entityText:
    "Alo King SARL (en cours de constitution), Liban. Vous pouvez nous joindre sur WhatsApp ou via la page de contact.",
  docs: [
    {
      slug: "terms",
      title: "Conditions d'utilisation",
      description: "Les règles pour commander avec Alo King sur WhatsApp et sur ce site.",
      intro:
        "Alo King vous permet de commander repas et produits du quotidien auprès de commerces du Liban en discutant sur WhatsApp. En commandant avec Alo King, vous acceptez ces conditions.",
      sections: [
        {
          h: "Ce qu'est Alo King",
          p: [
            "Alo King est un moyen de commander auprès de commerces indépendants. Le commerce prépare et vend votre commande. Alo King transmet votre commande au commerce, vous montre le total et suit la commande jusqu'à sa livraison ou son retrait.",
            "Un assistant aide à comprendre ce que vous écrivez ou dites. Il ne fait que proposer : les prix, frais et totaux viennent toujours de notre serveur et du menu du commerce, et une commande n'est passée que lorsque vous touchez Confirmer.",
          ],
        },
        {
          h: "Prix, frais et devise",
          ul: [
            "Le commerce fixe les prix de son menu. Nous n'y ajoutons jamais rien.",
            "Les frais de livraison dépendent de la distance par la route depuis le commerce et s'affichent avant de confirmer.",
            "Les totaux sont affichés en dollars américains et en livres libanaises au taux en vigueur au moment de la commande. Ce taux est verrouillé sur votre commande.",
            "Le total final ne peut changer que lorsque le commerce pèse des articles (par exemple la viande au kilo). Si la différence est importante, nous demandons de nouveau votre accord.",
          ],
        },
        {
          h: "Paiement",
          p: [
            "Vous payez à la livraison, en espèces, à la personne qui vous remet la commande, dans la devise acceptée par le commerce. Une limite s'applique aux commandes en espèces, et nous vous prévenons si votre commande la dépasse. Le paiement en ligne sera ajouté plus tard, avec ses propres conditions.",
          ],
        },
        {
          h: "Code de livraison",
          p: [
            "Pour certaines commandes (par exemple une première commande en espèces, ou une commande importante) nous vous donnons un court code. Donnez-le à la personne qui vous remet la commande. Il vous protège, ainsi que le commerce.",
          ],
        },
        {
          h: "Annulation",
          p: [
            "Vous pouvez annuler avant que le commerce accepte votre commande, et pendant un court moment après. Ensuite, nous transmettons votre demande au commerce, qui peut accepter s'il n'a pas commencé la préparation. Touchez « Ma commande » dans la discussion, puis Annuler.",
          ],
        },
        {
          h: "Votre part",
          ul: [
            "Donnez-nous une position correcte et un téléphone joignable.",
            "Soyez joignable à l'arrivée de la commande. Des livraisons manquées répétées peuvent nous conduire à suspendre les commandes en espèces pour votre numéro.",
            "N'utilisez pas le service de façon abusive : pas d'abus, pas de fausses commandes, pas de tentative de le détourner.",
          ],
        },
        {
          h: "Notre responsabilité",
          p: [
            "Nous travaillons à rendre la commande fiable, mais les commerces sont responsables des aliments et produits qu'ils vendent, et de leur préparation en toute sécurité. Les informations sur les allergènes et les régimes ne s'affichent que lorsque le commerce les a déclarées ; en cas d'allergie, vérifiez toujours auprès du commerce.",
            "Dans la mesure permise par la loi, Alo King n'est pas responsable des pertes indirectes. Rien ici ne limite les droits que vous donne la loi libanaise.",
          ],
        },
        {
          h: "Modifications et droit applicable",
          p: [
            "Nous pouvons mettre ces conditions à jour et changerons la date en haut de page. Le droit libanais s'applique et les tribunaux de Beyrouth sont compétents, sans retirer aucun droit qu'un consommateur tient de la loi impérative.",
          ],
        },
      ],
    },
    {
      slug: "privacy",
      title: "Confidentialité",
      description:
        "Les données qu'Alo King conserve, pourquoi, qui les traite et comment les supprimer. Messages vocaux et loi 81/2018.",
      intro:
        "Nous conservons le minimum nécessaire pour prendre votre commande. Cette page explique de quoi il s'agit, conformément à la loi libanaise 81/2018 relative aux transactions électroniques et aux données à caractère personnel.",
      sections: [
        {
          h: "Ce que nous collectons",
          ul: [
            "Votre numéro WhatsApp, le nom de votre profil et la langue dans laquelle vous écrivez.",
            "Vos messages à Alo King, et vos messages vocaux si vous en envoyez.",
            "Vos lieux de livraison : la position que vous partagez, avec en option un immeuble, un étage et une note.",
            "Vos commandes : ce que vous avez commandé, chez quel commerce, les totaux et le statut.",
            "Vos choix si vous nous les indiquez (par exemple un régime), et si vous avez accepté de recevoir du marketing.",
          ],
        },
        {
          h: "Pourquoi nous les utilisons",
          ul: [
            "Pour prendre, chiffrer, livrer et suivre vos commandes, et vous répondre.",
            "Pour garder le service sûr, et trouver et corriger les problèmes.",
            "Pour améliorer la compréhension par l'assistant de l'arabe libanais, de l'arabizi, du français et de l'anglais.",
            "Pour vous envoyer des offres uniquement si vous y avez consenti. Vous pouvez les arrêter à tout moment en envoyant STOP.",
          ],
        },
        {
          h: "Messages vocaux",
          p: [
            "Nous transformons un message vocal en texte pour que l'assistant lise votre commande, puis nous vous montrons le récapitulatif à confirmer. Nos prestataires de reconnaissance vocale et d'IA traitent les messages vocaux à cette fin.",
            "Lorsque vous corrigez l'assistant (« non, j'ai dit deux »), nous pouvons conserver le message, son texte et votre correction comme exemple pour rendre l'assistant plus précis. « Supprimer mes données » les supprime aussi.",
          ],
        },
        {
          h: "Qui voit vos données",
          ul: [
            "Le commerce et la personne qui livre votre commande voient ce dont ils ont besoin pour la préparer et la livrer : votre nom, vos articles et votre lieu de livraison. Votre numéro de téléphone n'est partagé que lorsque la livraison l'exige.",
            "Nos prestataires traitent des données pour notre compte : WhatsApp (Meta) et notre prestataire WhatsApp, nos prestataires de base de données et d'hébergement, des prestataires d'IA et de reconnaissance vocale, un prestataire de calcul d'itinéraire qui détermine la distance par la route à partir de coordonnées, et un service de suivi des erreurs qui retire numéros de téléphone et jetons des rapports.",
            "Nous ne vendons pas vos données. Nous ne publions pas vos positions.",
          ],
        },
        {
          h: "Où elles sont stockées et combien de temps",
          p: [
            "Notre base de données fonctionne dans l'Union européenne. Nous conservons les enregistrements de commandes aussi longtemps que la comptabilité et la loi l'exigent. L'historique des discussions et vos informations enregistrées sont conservés tant que vous utilisez Alo King, et jusqu'à ce que vous nous demandiez de les supprimer.",
          ],
        },
        {
          h: "Vos droits",
          ul: [
            "Envoyez « supprimer mes données » sur WhatsApp. Nous vous demandons de confirmer, puis nous effaçons votre historique, vos adresses et vos informations. Les enregistrements que nous devons conserver pour la comptabilité restent, sans vos informations personnelles lorsque la loi le permet.",
            "Envoyez « oublier mon historique » pour effacer ce que l'assistant retient de vos commandes habituelles.",
            "Demandez à consulter, corriger ou exporter vos données via la page de contact.",
            "Envoyez STOP pour arrêter immédiatement les messages marketing.",
          ],
        },
        {
          h: "Enfants",
          p: [
            "Alo King s'adresse aux adultes. Si vous pensez qu'un enfant l'a utilisé, dites-le-nous et nous supprimerons les données.",
          ],
        },
        {
          h: "Contact",
          p: [
            "Pour toute question ou réclamation sur vos données, utilisez la page de contact. Alo King SARL (en cours de constitution) est responsable des données décrites ici.",
          ],
        },
        {
          h: "Commerçants et livreurs",
          p: [
            "Si vous revendiquez ou enregistrez une activité sur ce site, nous conservons votre nom, votre numéro WhatsApp, les informations sur l'activité que vous donnez et les documents que vous envoyez (registre de commerce, autorisation, document de société, photo de l'enseigne). Nous les utilisons uniquement pour vérifier que l'activité est la vôtre et pour vous répondre. Une personne chez Alo King les lit. Vous pouvez nous demander à tout moment de supprimer votre demande et vos documents.",
            "Si vous postulez pour livrer, nous conservons votre nom, votre numéro, votre zone, votre véhicule, votre réponse sur le permis, vos langues et disponibilités, et votre note. Nous les utilisons uniquement pour vous contacter au sujet de la candidature. Dites-le-nous sur WhatsApp et nous la supprimons.",
            "Pendant une revendication, votre navigateur garde le numéro de la demande et le téléphone saisi dans son stockage de session, pour qu'un rechargement ne vous fasse pas perdre votre place. Il est effacé quand vous fermez l'onglet.",
          ],
        },
      ],
    },
    {
      slug: "refund",
      title: "Politique de remboursement",
      description:
        "Ce qui se passe lorsqu'une commande est annulée, erronée, incomplète ou n'arrive pas.",
      intro:
        "La plupart des commandes sont payées en espèces à la livraison : la plupart des problèmes se règlent donc avant que l'argent change de mains. Voici ce que nous faisons quand quelque chose ne va pas.",
      sections: [
        {
          h: "Paiement à la livraison",
          ul: [
            "Si la commande est annulée, refusée ou non livrée, vous ne payez rien.",
            "Si un article manque ou est erroné à l'arrivée, ne le payez pas. Dites-le à la personne qui livre, puis écrivez-nous sur WhatsApp.",
          ],
        },
        {
          h: "Quand il y a un problème avec votre commande",
          ul: [
            "Touchez « Une personne » dans la discussion, ou écrivez-nous, avec le code de votre commande.",
            "Dites-nous ce qui ne va pas, et ajoutez une photo si possible.",
            "Nous contactons le commerce. S'il est d'accord, la solution est une correction, un remplacement ou un avoir sur la commande.",
          ],
        },
        {
          h: "Commandes qui ne peuvent pas être annulées",
          p: [
            "Une fois que le commerce a commencé à préparer votre commande, il peut refuser l'annulation. Un plat préparé correctement comme commandé n'est pas remboursable pour cause de changement d'avis.",
          ],
        },
        {
          h: "Paiements en ligne",
          p: [
            "Lorsque le paiement en ligne sera ajouté, les remboursements retourneront vers le même moyen de paiement, et cette page indiquera le délai.",
          ],
        },
        {
          h: "Notre engagement",
          p: [
            "Nous répondons à chaque message concernant un problème. De nombreux cas sont réglés dans la discussion le jour même.",
          ],
        },
      ],
    },
    {
      slug: "cookies",
      title: "Cookies",
      description:
        "Comment ce site utilise les cookies et le stockage similaire. Nous n'en utilisons presque aucun.",
      intro: "Ce site est conçu pour ne presque pas avoir besoin de cookies.",
      sections: [
        {
          h: "Ce que nous stockons",
          ul: [
            "Votre langue est dans l'adresse de la page (/ar, /en ou /fr). Nous n'avons pas besoin de cookie pour cela.",
            "Nous n'utilisons pas de cookies d'analyse. Si nous ajoutons un comptage des visites, il fonctionnera sans cookie et sans donnée personnelle.",
            "Les rapports d'erreurs, si le site plante, sont expurgés des numéros de téléphone et des jetons.",
          ],
        },
        {
          h: "Publicité",
          p: [
            "Nous n'utilisons aujourd'hui ni cookies publicitaires ni cookies de suivi. Si nous ajoutons un jour un outil publicitaire, nous vous le demanderons d'abord et mettrons cette page à jour.",
          ],
        },
        {
          h: "Tiers",
          p: [
            "Ouvrir WhatsApp depuis ce site vous transfère à WhatsApp, qui a ses propres règles. Les polices et les images sont servies par notre propre site. La carte de la page d'enregistrement d'une activité charge ses tuiles depuis OpenStreetMap, qui voit alors votre adresse IP ; elle ne se charge que lorsque vous demandez la carte.",
          ],
        },
        {
          h: "Votre contrôle",
          p: [
            "Vous pouvez effacer les données du site dans votre navigateur à tout moment. Le site fonctionne sans elles.",
          ],
        },
      ],
    },
    {
      slug: "merchant-terms",
      title: "Conditions pour les commerçants",
      description:
        "Les conditions pour les commerces qui revendiquent ou enregistrent leur fiche sur Alo King et prennent des commandes par WhatsApp.",
      intro:
        "Ces conditions lient votre activité à Alo King. Elles s'appliquent quand vous revendiquez un commerce, en enregistrez un nouveau ou prenez des commandes via Alo King. C'est la version pilote, que notre avocat relira avant le lancement.",
      sections: [
        {
          h: "Qui peut rejoindre",
          ul: [
            "Vous devez être le propriétaire de l'activité, ou autorisé par lui à agir en son nom. Revendiquer une activité qui n'est pas la vôtre, ou fournir de faux documents, met fin à votre accès et peut être signalé.",
            "Nous vérifions la propriété par un code envoyé au numéro de téléphone du commerce lui-même, ou par votre registre de commerce ou votre autorisation et une photo de l'enseigne. Une personne chez Alo King approuve les demandes qui exigent des documents.",
            "Deux personnes qui revendiquent le même commerce, la vente d'une activité, la perte d'un téléphone et une demande de suppression de fiche suivent chacune les étapes affichées dans le parcours de revendication. Tant que rien n'est réglé, nous pouvons geler la fiche.",
          ],
        },
        {
          h: "Votre page et votre menu",
          ul: [
            "Votre fiche commence avec des informations publiques comme le nom, l'adresse et la position. Chacune est marquée « à confirmer » tant que vous ne l'avez pas confirmée ou corrigée. Rien n'est présenté aux clients comme vôtre avant que vous ne la revendiquiez.",
            "Vous fixez votre menu, vos prix, vos horaires, votre zone et vos frais de livraison dans les tranches que nous publions. Nous ne modifions jamais un prix, la disponibilité d'un article ou vos horaires sans votre appui. L'assistant ne fait que proposer ; vous confirmez.",
            "Les mentions d'allergènes et de régimes sont uniquement ce que vous déclarez. Les estimations de calories et de nutriments sont signalées comme des estimations tant que vous ne les confirmez pas. Vous êtes responsable de ce que vous déclarez.",
            "Vous pouvez inviter du personnel par numéro de téléphone avec un rôle : propriétaire, gérant, caissier, cuisine ou livreur. Seuls les propriétaires et les gérants modifient les prix et le menu.",
          ],
        },
        {
          h: "Commandes",
          ul: [
            "Alo King envoie chaque commande à votre commerce par les canaux que vous choisissez. Vous l'acceptez ou la refusez. Sans réponse, nous essayons votre canal de secours, puis un appel, puis un opérateur, et au bout de cinq minutes nous annulons la commande et prévenons le client.",
            "Si trois commandes de suite sont manquées, nous mettons votre commerce en pause jusqu'à ce que vous le réactiviez. Une pause que vous avez décidée est la vôtre : nous ne la levons pas.",
            "Vous préparez la commande comme acceptée et tenez l'heure de préparation annoncée. Vous pouvez refuser une commande pour un motif comme une rupture. Refuser ou manquer des commandes à répétition peut nous conduire à suspendre votre fiche.",
            "Pour les articles vendus au poids, le prix final suit le poids réel. Une hausse importante attend l'appui du client.",
          ],
        },
        {
          h: "Frais",
          ul: [
            "Alo King facture des frais pour chaque commande livrée ou retirée. Les frais, et toute période gratuite, figurent sur notre page Pour les commerçants, et vous les voyez avant de démarrer.",
            "Nous n'ajoutons rien aux prix de votre menu et ne facturons rien par mois pour votre page.",
            "Un changement de frais ne s'applique qu'aux commandes passées après le changement, et nous vous prévenons avant qu'il ne commence.",
            "Les frais sont enregistrés sur votre compte. La façon dont ils sont réglés, avec un crédit Alo King ou par relevé mensuel, sera précisée avant le début du paiement en ligne.",
          ],
        },
        {
          h: "Paiements et espèces",
          p: [
            "Aujourd'hui, chaque commande se paie en espèces à la livraison, à la personne qui remet la commande, dans les devises que votre commerce accepte. Le client voit les dollars et les livres libanaises au taux verrouillé sur la commande.",
            "Le paiement en ligne n'est pas activé. Quand il le sera, il suivra le mandat d'encaissement, que vous acceptez séparément.",
          ],
        },
        {
          h: "Clients et leurs données",
          ul: [
            "Utilisez le nom, le numéro et l'adresse d'un client uniquement pour préparer et livrer sa commande et traiter les problèmes qui s'y rapportent. Ne les ajoutez pas à vos propres listes, ne les partagez pas et ne les contactez pas pour du marketing.",
            "Le marketing auprès des clients passe uniquement par Alo King, uniquement pour ceux qui l'ont accepté, et s'arrête dès qu'ils disent STOP.",
            "Alo King protège les données personnelles comme l'exige la loi libanaise 81/2018. Un client peut nous demander de supprimer ses données.",
          ],
        },
        {
          h: "Fin de la relation",
          p: [
            "Vous pouvez à tout moment mettre en pause, fermer ou demander la suppression de votre fiche. Les commandes déjà acceptées doivent être honorées. Nous pouvons suspendre ou supprimer une fiche en cas d'informations fausses, de commandes manquées à répétition, de nourriture dangereuse ou de non-respect de ces conditions. Les écritures à conserver pour la comptabilité restent, sans données personnelles lorsque la loi le permet.",
          ],
        },
        {
          h: "Droit applicable",
          p: [
            "Ces conditions sont régies par le droit libanais. Elles seront mises à jour, avec une nouvelle date, quand la société sera enregistrée et que l'avocat les aura relues.",
          ],
        },
      ],
    },
    {
      slug: "collection-mandate",
      title: "Mandat d'encaissement",
      description:
        "Comment Alo King encaissera les paiements en ligne pour le compte d'un commerce, une fois le paiement en ligne activé.",
      intro:
        "Ce mandat est pour le jour où le paiement en ligne sera activé. D'ici là, chaque commande se paie en espèces à la livraison, nous n'encaissons rien pour vous et cette page n'a aucun effet. Nous la publions dès maintenant pour que vous puissiez la lire avant de nous rejoindre.",
      sections: [
        {
          h: "Ce que vous autorisez",
          p: [
            "Quand un client paie une commande en ligne (par carte ou par un service de paiement que nous proposons), vous autorisez Alo King à recevoir ce paiement pour votre compte, en tant que mandataire, pour les commandes passées dans votre commerce via Alo King et pour ces commandes seulement.",
            "Le paiement du client est inscrit dans notre registre comme une somme qui vous est due, moins nos frais et tout remboursement. Le paiement n'est pas un revenu d'Alo King.",
          ],
        },
        {
          h: "Ce que nous faisons de l'argent",
          ul: [
            "Chaque paiement, frais, remboursement et versement est une écriture distincte dans un registre qu'on ne modifie jamais, en dollars et en livres libanaises au taux verrouillé sur la commande. Une correction est une nouvelle écriture.",
            "Nous vous versons ce que le registre montre qui vous est dû, selon le calendrier de règlement que nous publierons avant le début du paiement en ligne, avec un relevé pour chaque période.",
            "Avant l'activation du paiement en ligne, nous vous indiquerons comment l'argent reçu pour vous est détenu, de la manière que confirment notre avocat et notre banque.",
          ],
        },
        {
          h: "Remboursements et litiges",
          ul: [
            "Si une commande est annulée, refusée ou erronée par la faute du commerce, le client est remboursé et le montant est déduit de ce que nous vous devons. Si le problème vient de nous, il ne l'est pas.",
            "Si un client conteste un paiement, nous vous le disons et vous montrons ce que nous détenons. Tant que ce n'est pas réglé, nous pouvons retenir le montant contesté.",
            "Quand une commande est payée en ligne et qu'un article est vendu au poids, le client est débité du poids réel, et la différence est remboursée ou encaissée avec son accord.",
          ],
        },
        {
          h: "Limites et vos droits",
          ul: [
            "Nous pouvons fixer une limite de versement pendant que le commerce est nouveau, et nous vous l'indiquons.",
            "Vous pouvez demander à voir chaque écriture qui vous concerne et à ce qu'on vous l'explique.",
            "Vous pouvez retirer ce mandat à tout moment pour les nouvelles commandes. Les commandes déjà payées sont réglées comme ci-dessus.",
          ],
        },
        {
          h: "Statut de cette page",
          p: [
            "Le modèle d'encaissement exact dépend des règles de la Banque du Liban et de l'avis de notre avocat, que nous attendons. Cette page sera complétée et redatée avant l'activation du paiement en ligne, et il vous sera demandé d'accepter le texte final.",
          ],
        },
      ],
    },
  ],
};
